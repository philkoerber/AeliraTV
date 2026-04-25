import * as THREE from "three";

/**
 * Standard material that mixes far/near albedo maps per-instance using
 * `aLodBlend` / `aChunkFade` instanced attributes (see `DecorMergedInstancing`).
 */
export function createDecorDualMapInstancedMaterial(opts: {
  farMap: THREE.Texture;
  nearMap: THREE.Texture;
  farNormalMap?: THREE.Texture;
  roughness: number;
  metalness: number;
  transparent?: boolean;
  alphaTest?: number;
  side?: THREE.Side;
}): THREE.MeshStandardMaterial {
  const alphaTest = opts.alphaTest ?? 0;
  const m = new THREE.MeshStandardMaterial({
    map: opts.farMap,
    normalMap: opts.farNormalMap,
    roughness: opts.roughness,
    metalness: opts.metalness,
    transparent: !!opts.transparent,
    alphaTest,
    side: opts.side ?? THREE.FrontSide,
    // Cutouts need depth; translucent cards disable depth write.
    depthWrite: alphaTest > 0 ? true : !opts.transparent,
  });

  m.userData.nearMap = opts.nearMap;

  m.onBeforeCompile = (shader) => {
    shader.uniforms.nearMap = { value: opts.nearMap };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aLodBlend;
attribute float aChunkFade;
varying float vLodBlend;
varying float vChunkFade;
`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vLodBlend = aLodBlend;
vChunkFade = aChunkFade;
`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D nearMap;
varying float vLodBlend;
varying float vChunkFade;
`,
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
	vec4 texFar = texture2D( map, vMapUv );
	vec4 texNear = texture2D( nearMap, vMapUv );
	vec4 texMix = mix( texFar, texNear, clamp( vLodBlend, 0.0, 1.0 ) );
	diffuseColor *= texMix * vec4( vec3( max( vChunkFade, 0.0 ) ), 1.0 );
#endif
`,
      );
  };

  return m;
}
