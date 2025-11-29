# NormalBaker.js

A simple, client-side tool for baking normal maps from a high-poly to a low-poly mesh directly in your browser. This project uses Three.js and `three-mesh-bvh` for accelerated raycasting.

## Features

*   **No Backend Required:** Runs entirely in the browser.
*   **Live 3D Preview:** View your high poly, low poly, and the final baked normal map in a real-time 3D viewport.
*   **Configurable Bake Settings:** Adjust cage distance, texture size, and more.
*   **UV Layout Viewer:** See the UV wireframe of your low-poly model.

## How to Use

1.  Upload your high-poly `.obj` model.
2.  Upload your low-poly `.obj` model (must have UVs).
3.  Adjust the bake settings as needed.
4.  Click "Bake Texture".
5.  Preview the result and download your normal map as a PNG.

## License

This project is licensed under the **MIT License**.
