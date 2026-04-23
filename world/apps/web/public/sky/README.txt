Sky / dome backgrounds (optional HDRI or equirectangular)

This folder is for static sky assets you add locally (not committed as binaries here).

Free CC0 / public-domain sources that work well as inverted-sphere or skydome textures:

- Poly Haven — https://polyhaven.com/hdris (CC0 HDRIs; use a soft outdoor sky, lower exposure for a stylized look)
- ambientCG — https://ambientcg.com/?list=hdri (CC0 HDRIs)
- NASA Visible Earth (credited imagery) — for atmosphere references only; prefer CC0 HDRIs for game use

Typical workflow: download a small equirectangular HDR or JPG, place it as e.g. `public/sky/dome.jpg`, then swap the gradient in `WorldScene.tsx` `SkyBackdrop` for a `TextureLoader` + `MeshBasicMaterial` mapped to the inside of a sphere (`side: BackSide`, `depthWrite: false`, `fog: false`).
