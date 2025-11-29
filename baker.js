import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// --- BVH SETUP ---
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const loader = new OBJLoader();

export function loadObjFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const res = loader.parse(e.target.result);
                
                // CRITICAL FIX: Ensure hierarchy transforms are applied
                res.updateMatrixWorld(true);
                
                let foundMesh = null;
                
                res.traverse(child => {
                    if (child.isMesh && !foundMesh) {
                        foundMesh = child;
                    }
                });

                if (foundMesh) {
                    // Clone geometry to avoid modifying the cached loader resource
                    const geom = foundMesh.geometry.clone();
                    
                    // CRITICAL FIX: Bake the Object/Group transform into the vertices
                    // This ensures High and Low poly align exactly as exported
                    geom.applyMatrix4(foundMesh.matrixWorld);
                    
                    // Create a new clean mesh at 0,0,0 since geometry is now in World Space
                    const cleanMesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial());
                    resolve(cleanMesh);
                } else {
                    reject("No mesh found in OBJ");
                }
            } catch(err) { reject(err); }
        };
        reader.readAsText(file);
    });
}

function generateSmoothedNormals(geometry) {
    const posAttribute = geometry.attributes.position;
    const count = posAttribute.count;
    // Map to store accumulated normals for shared positions
    const positionMap = new Map();
    const precision = 10000; 
    
    const getKey = (x, y, z) => {
        return `${Math.round(x * precision)}_${Math.round(y * precision)}_${Math.round(z * precision)}`;
    };

    // 1. Initialize accumulators
    for (let i = 0; i < count; i++) {
        const key = getKey(posAttribute.getX(i), posAttribute.getY(i), posAttribute.getZ(i));
        if (!positionMap.has(key)) positionMap.set(key, new THREE.Vector3());
    }

    const index = geometry.index;
    const faceCount = index ? index.count / 3 : count / 3;
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const cb = new THREE.Vector3(), ab = new THREE.Vector3();

    // 2. Accumulate Face Normals
    for (let f = 0; f < faceCount; f++) {
        let a, b, c;
        if (index) {
            a = index.getX(f * 3); b = index.getY(f * 3); c = index.getZ(f * 3);
        } else {
            a = f * 3; b = f * 3 + 1; c = f * 3 + 2;
        }

        vA.fromBufferAttribute(posAttribute, a);
        vB.fromBufferAttribute(posAttribute, b);
        vC.fromBufferAttribute(posAttribute, c);

        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab); // Weighted by area

        const keyA = getKey(vA.x, vA.y, vA.z);
        const keyB = getKey(vB.x, vB.y, vB.z);
        const keyC = getKey(vC.x, vC.y, vC.z);

        positionMap.get(keyA).add(cb);
        positionMap.get(keyB).add(cb);
        positionMap.get(keyC).add(cb);
    }

    // 3. Write back normalized results
    const smoothNormals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const key = getKey(posAttribute.getX(i), posAttribute.getY(i), posAttribute.getZ(i));
        const n = positionMap.get(key).clone().normalize();
        smoothNormals[i*3] = n.x;
        smoothNormals[i*3+1] = n.y;
        smoothNormals[i*3+2] = n.z;
    }
    return smoothNormals;
}

// --- BARYCENTRIC HELPERS ---
const _tri = new THREE.Triangle();
const _bar = new THREE.Vector3();
const _nA = new THREE.Vector3();
const _nB = new THREE.Vector3();
const _nC = new THREE.Vector3();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();

function getSmoothedHitNormal(hit, mesh) {
    if (!mesh.geometry.attributes.normal) {
        // Fallback for missing normals
        return hit.face.normal.clone().normalize();
    }

    const face = hit.face;
    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const norm = geometry.attributes.normal;

    // Use World Space (which matches geometry now)
    _vA.fromBufferAttribute(pos, face.a);
    _vB.fromBufferAttribute(pos, face.b);
    _vC.fromBufferAttribute(pos, face.c);

    _tri.set(_vA, _vB, _vC);
    _tri.getBarycoord(hit.point, _bar);

    _nA.fromBufferAttribute(norm, face.a);
    _nB.fromBufferAttribute(norm, face.b);
    _nC.fromBufferAttribute(norm, face.c);

    const finalNorm = new THREE.Vector3();
    finalNorm.addScaledVector(_nA, _bar.x);
    finalNorm.addScaledVector(_nB, _bar.y);
    finalNorm.addScaledVector(_nC, _bar.z);

    return finalNorm.normalize();
}

export function bakeNormalMap(meshHigh, meshLow, options, onProgress) {
    return new Promise((resolve, reject) => {
        try {
            const size = options.size;
            const maxFront = Math.max(0.0001, options.maxFront);
            const maxRear = Math.max(0.0001, options.maxRear);
            const useAverageNormals = options.useAverageNormals;
            const ignoreBackface = options.ignoreBackface;

            // --- PREP GEOMETRY ---
            // Ensure normals exist
            if (!meshHigh.geometry.attributes.normal) meshHigh.geometry.computeVertexNormals();
            if (!meshLow.geometry.attributes.normal) meshLow.geometry.computeVertexNormals();

            // Compute BVH for High Poly
            if (!meshHigh.geometry.boundsTree) {
                meshHigh.geometry.computeBoundsTree();
            }

            // Since we baked transforms in loadObjFile, world matrices are Identity
            meshHigh.updateMatrixWorld();
            meshLow.updateMatrixWorld();

            let smoothedNormalsArray = null;
            if (useAverageNormals) {
                smoothedNormalsArray = generateSmoothedNormals(meshLow.geometry);
            }

            const buffer = new Uint8ClampedArray(size * size * 4);
            // Fill Background: Neutral Normal (128, 128, 255)
            buffer.fill(255); // Alpha
            for(let i=0; i<buffer.length; i+=4) {
                buffer[i] = 128; buffer[i+1] = 128; buffer[i+2] = 255; 
            }

            const geo = meshLow.geometry;
            const pos = geo.attributes.position;
            const uv = geo.attributes.uv;
            const norm = geo.attributes.normal;
            const index = geo.index;

            if (!uv) throw new Error("Low poly has no UVs.");

            const raycaster = new THREE.Raycaster();
            raycaster.firstHitOnly = false; 
            
            const faceCount = index ? index.count / 3 : pos.count / 3;
            let currentFace = 0;
            
            // Reusable vectors
            const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
            const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
            const snA = new THREE.Vector3(), snB = new THREE.Vector3(), snC = new THREE.Vector3();
            const uvA = new THREE.Vector2(), uvB = new THREE.Vector2(), uvC = new THREE.Vector2();
            const pUV = new THREE.Vector2(), iPos = new THREE.Vector3();
            const iNorm = new THREE.Vector3(), iSmoothNorm = new THREE.Vector3();
            const tangent = new THREE.Vector3(), edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3();
            const scanOrigin = new THREE.Vector3(), scanDir = new THREE.Vector3();

            const processBatch = () => {
                const startT = performance.now();
                // Process for 15ms
                while(currentFace < faceCount && (performance.now() - startT) < 15) {
                    
                    let a, b, c;
                    if(index) {
                        a = index.getX(currentFace*3); b = index.getY(currentFace*3); c = index.getZ(currentFace*3);
                    } else {
                        a = currentFace*3; b = currentFace*3+1; c = currentFace*3+2;
                    }

                    // Vertices (Already in World Space due to loadObjFile fix)
                    vA.fromBufferAttribute(pos, a); vB.fromBufferAttribute(pos, b); vC.fromBufferAttribute(pos, c);
                    uvA.fromBufferAttribute(uv, a); uvB.fromBufferAttribute(uv, b); uvC.fromBufferAttribute(uv, c);
                    
                    // Normals
                    nA.fromBufferAttribute(norm, a); nB.fromBufferAttribute(norm, b); nC.fromBufferAttribute(norm, c);

                    if (useAverageNormals) {
                        snA.set(smoothedNormalsArray[a*3], smoothedNormalsArray[a*3+1], smoothedNormalsArray[a*3+2]);
                        snB.set(smoothedNormalsArray[b*3], smoothedNormalsArray[b*3+1], smoothedNormalsArray[b*3+2]);
                        snC.set(smoothedNormalsArray[c*3], smoothedNormalsArray[c*3+1], smoothedNormalsArray[c*3+2]);
                    }

                    // --- TANGENT CALCULATION ---
                    edge1.subVectors(vB, vA);
                    edge2.subVectors(vC, vA);
                    
                    const dUV1 = new THREE.Vector2().subVectors(uvB, uvA);
                    const dUV2 = new THREE.Vector2().subVectors(uvC, uvA);
                    let f = 1.0 / (dUV1.x * dUV2.y - dUV2.x * dUV1.y);
                    if (!isFinite(f)) f = 1.0;
                    
                    tangent.set(
                        f * (dUV2.y * edge1.x - dUV1.y * edge2.x),
                        f * (dUV2.y * edge1.y - dUV1.y * edge2.y),
                        f * (dUV2.y * edge1.z - dUV1.y * edge2.z)
                    ).normalize();

                    // Bounding Box
                    const minX = Math.max(0, Math.floor(Math.min(uvA.x, uvB.x, uvC.x) * size));
                    const maxX = Math.min(size - 1, Math.ceil(Math.max(uvA.x, uvB.x, uvC.x) * size));
                    const minY = Math.max(0, Math.floor(Math.min(uvA.y, uvB.y, uvC.y) * size));
                    const maxY = Math.min(size - 1, Math.ceil(Math.max(uvA.y, uvB.y, uvC.y) * size));

                    if (maxX >= minX && maxY >= minY) {
                        for (let y = minY; y <= maxY; y++) {
                            for (let x = minX; x <= maxX; x++) {
                                pUV.set((x+0.5)/size, (y+0.5)/size);
                                
                                // Barycentric weights
                                const uv0 = { x: uvB.x - uvA.x, y: uvB.y - uvA.y };
                                const uv1 = { x: uvC.x - uvA.x, y: uvC.y - uvA.y };
                                const uv2 = { x: pUV.x - uvA.x, y: pUV.y - uvA.y };
                                
                                const denom = uv0.x * uv1.y - uv1.x * uv0.y;
                                if(Math.abs(denom) < 1e-8) continue;
                                
                                const v = (uv2.x * uv1.y - uv1.x * uv2.y) / denom;
                                const w = (uv0.x * uv2.y - uv2.x * uv0.y) / denom;
                                const u = 1.0 - v - w;

                                if (u < 0 || v < 0 || w < 0) continue;

                                // Interpolate Position & Normal
                                iPos.copy(vA).multiplyScalar(u).addScaledVector(vB, v).addScaledVector(vC, w);
                                iNorm.copy(nA).multiplyScalar(u).addScaledVector(nB, v).addScaledVector(nC, w).normalize();

                                let rayDir = iNorm;
                                if (useAverageNormals) {
                                    iSmoothNorm.copy(snA).multiplyScalar(u).addScaledVector(snB, v).addScaledVector(snC, w).normalize();
                                    rayDir = iSmoothNorm;
                                }

                                // --- RAYCAST (CAGE METHOD) ---
                                // Start 'maxFront' away from surface, shoot INWARDS
                                scanOrigin.copy(iPos).addScaledVector(rayDir, maxFront);
                                scanDir.copy(rayDir).negate();
                                
                                raycaster.set(scanOrigin, scanDir);
                                raycaster.far = maxFront + maxRear;

                                const hits = raycaster.intersectObject(meshHigh, true);
                                
                                let bestHit = null;
                                let bestDist = Infinity;

                                // Find first valid hit
                                for(const h of hits) {
                                    // Backface Check (HighPoly Normal vs Ray Dir)
                                    // Ray is IN, HighPoly Normal is OUT. Should be opposed (Dot < 0).
                                    // If Dot > 0, we are hitting the back of a polygon (inside out).
                                    const hpFaceNorm = h.face.normal; // Geometry is pre-transformed
                                    const isBackface = scanDir.dot(hpFaceNorm) > 0;

                                    if (ignoreBackface && isBackface) continue;

                                    if (h.distance < bestDist) {
                                        bestDist = h.distance;
                                        bestHit = h;
                                    }
                                }

                                if (bestHit) {
                                    const hpNorm = getSmoothedHitNormal(bestHit, meshHigh);
                                    
                                    // Gram-Schmidt Orthogonalization
                                    // Ensure Tangent is perpendicular to Normal
                                    const t = tangent.clone();
                                    t.sub(iNorm.clone().multiplyScalar(iNorm.dot(t))).normalize();
                                    
                                    // Calculate Binormal (Bitangent)
                                    // T x N = B (Right Handed?) or N x T = B? 
                                    // Standard Three.js/OpenGL: N x T = B (Y+)
                                    const bVec = new THREE.Vector3().crossVectors(iNorm, t).normalize();

                                    // Project High Poly normal into Tangent Space
                                    const tX = t.dot(hpNorm);
                                    const tY = bVec.dot(hpNorm);
                                    const tZ = iNorm.dot(hpNorm);

                                    // Remap -1..1 to 0..255
                                    const r = (tX * 0.5 + 0.5) * 255;
                                    const g = (tY * 0.5 + 0.5) * 255;
                                    const bl = (tZ * 0.5 + 0.5) * 255;

                                    // Fill buffer (Flip Y for Canvas)
                                    const idx = ((size - 1 - y) * size + x) * 4;
                                    buffer[idx] = r; 
                                    buffer[idx+1] = g; 
                                    buffer[idx+2] = bl; 
                                    buffer[idx+3] = 255;
                                }
                            }
                        }
                    }
                    currentFace++;
                }

                if (onProgress) onProgress(currentFace / faceCount);

                if (currentFace < faceCount) {
                    requestAnimationFrame(processBatch);
                } else {
                    resolve(buffer);
                }
            };
            processBatch();

        } catch (e) { reject(e); }
    });
}