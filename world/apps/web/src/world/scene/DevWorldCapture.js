import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { heightAt } from "@aeliratv/shared-world";
import { registerAeliraDevApi } from "../dev/worldDevAccess.js";
export function DevWorldCapture({ terrainSeed }) {
    const { gl, scene } = useThree();
    const devCam = useMemo(() => new THREE.PerspectiveCamera(60, 1, 0.1, 600), []);
    useEffect(() => {
        const captureScreenshot = (opts) => {
            const eyeOff = opts.eyeOffset ?? 1.75;
            const lookOff = opts.lookOffset ?? 1.2;
            const px = opts.position.x;
            const pz = opts.position.z;
            const py = opts.position.y ?? heightAt(px, pz, { seed: terrainSeed }) + eyeOff;
            const lx = opts.lookAt?.x ?? 0;
            const lz = opts.lookAt?.z ?? 0;
            const ly = opts.lookAt?.y ?? heightAt(lx, lz, { seed: terrainSeed }) + lookOff;
            const buf = new THREE.Vector2();
            gl.getDrawingBufferSize(buf);
            const dw = buf.x;
            const dh = buf.y;
            devCam.fov = opts.fov ?? 60;
            devCam.aspect = Math.max(1e-6, dw / dh);
            devCam.near = opts.near ?? 0.1;
            devCam.far = opts.far ?? 600;
            devCam.updateProjectionMatrix();
            devCam.position.set(px, py, pz);
            devCam.lookAt(lx, ly, lz);
            scene.updateMatrixWorld(true);
            const prev = new THREE.Vector4();
            gl.getViewport(prev);
            gl.setViewport(0, 0, dw, dh);
            const prevAutoClear = gl.autoClear;
            gl.autoClear = true;
            gl.clear(true, true, true);
            gl.render(scene, devCam);
            gl.autoClear = prevAutoClear;
            gl.setViewport(prev.x, prev.y, prev.z, prev.w);
            return gl.domElement.toDataURL("image/png");
        };
        const api = { version: 1, captureScreenshot };
        return registerAeliraDevApi(api);
    }, [gl, scene, devCam, terrainSeed]);
    return null;
}
