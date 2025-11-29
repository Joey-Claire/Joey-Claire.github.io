import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class PreviewRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        
        // State
        this.highMesh = null;
        this.lowMesh = null;
        this.currentNormalMap = null;
        
        this.showHigh = false;
        this.showLow = true;

        // Materials
        this.matStandard = new THREE.MeshStandardMaterial({
            color: 0xcccccc, roughness: 0.4, metalness: 0.1, normalScale: new THREE.Vector2(1, 1)
        });
        
        // Comparison Materials
        this.matRed = new THREE.MeshStandardMaterial({
            color: 0xff0000, roughness: 0.5, metalness: 0.1,
            transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide
        });
        this.matBlue = new THREE.MeshStandardMaterial({
            color: 0x0044ff, roughness: 0.5, metalness: 0.1,
            wireframe: true, transparent: true, opacity: 0.5
        });

        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x222222);

        // Add Grid Helper
        // Size 20, divisions 20, colorCenter: Light Grey, colorGrid: Darker Grey
        const grid = new THREE.GridHelper(20, 20, 0x888888, 0x444444);
        grid.position.y = 0;
        this.scene.add(grid);

        this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 0.1, 100);
        this.camera.position.set(2, 2, 2);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping; 
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;

        this.renderer.setAnimationLoop(() => {
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        });
        
        window.addEventListener('resize', () => this.resize());
    }

    // Set geometries. High is optional (if user only loaded low for some reason)
    setMeshes(geoHigh, geoLow) {
        // Clear old
        if (this.highMesh) { this.scene.remove(this.highMesh); this.highMesh.geometry.dispose(); this.highMesh = null; }
        if (this.lowMesh) { this.scene.remove(this.lowMesh); this.lowMesh.geometry.dispose(); this.lowMesh = null; }

        // Setup High
        if (geoHigh) {
            const hGeo = geoHigh.clone();
            if (!hGeo.attributes.normal) hGeo.computeVertexNormals();
            this.highMesh = new THREE.Mesh(hGeo, this.matRed);
            this.scene.add(this.highMesh);
        }

        // Setup Low
        if (geoLow) {
            const lGeo = geoLow.clone();
            if (!lGeo.attributes.normal) lGeo.computeVertexNormals();
            this.lowMesh = new THREE.Mesh(lGeo, this.matStandard);
            this.scene.add(this.lowMesh);
            
            // Center camera on Low
            lGeo.computeBoundingBox();
            const center = lGeo.boundingBox.getCenter(new THREE.Vector3());
            const size = lGeo.boundingBox.getSize(new THREE.Vector3()).length();
            
            this.controls.target.copy(center);
            this.camera.position.copy(center).add(new THREE.Vector3(size, size * 0.5, size));
            this.controls.update();
        }

        this.updateVisibility(this.showHigh, this.showLow);
    }

    updateVisibility(showHigh, showLow) {
        this.showHigh = showHigh;
        this.showLow = showLow;

        const isComparison = showHigh && showLow;

        if (this.highMesh) {
            this.highMesh.visible = showHigh;
            // High is Red in comparison, or Standard (Grey) if viewed alone? 
            // Usually High poly is just geometry inspection, but let's keep it Red/Standard.
            this.highMesh.material = isComparison ? this.matRed : this.matStandard;
            // If alone, remove normal map from standard material so we see geometry
            if (!isComparison) {
                this.highMesh.material = this.matStandard.clone(); // Clone to not affect low
                this.highMesh.material.normalMap = null;
                this.highMesh.material.color.setHex(0xcccccc);
            }
        }

        if (this.lowMesh) {
            this.lowMesh.visible = showLow;
            
            if (isComparison) {
                this.lowMesh.material = this.matBlue;
            } else {
                // Restore Normal Map Preview Mode
                this.lowMesh.material = this.matStandard;
                this.lowMesh.material.color.setHex(0xcccccc);
                this.lowMesh.material.wireframe = false;
                this.lowMesh.material.transparent = false;
                
                if (this.currentNormalMap) {
                    this.lowMesh.material.normalMap = this.currentNormalMap;
                    this.lowMesh.material.needsUpdate = true;
                }
            }
        }
    }

    updateNormalMap(canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.NoColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        
        this.currentNormalMap = texture;
        
        if (this.lowMesh && !this.showHigh) {
            this.lowMesh.material.normalMap = texture;
            this.lowMesh.material.needsUpdate = true;
        }
    }

    resize() {
        if (!this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }
}