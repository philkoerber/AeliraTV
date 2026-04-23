/**
 * Organic stylized ground (lo-fi / low-poly friendly):
 * - Stochastic anti-tiling: 3 rotated samples of `map` + FBM weights (common game approach).
 * - Optional `groundDetailMap`: seamless-tile detail (world repeats; non-toroidal maps show seam lines).
 * - Single low-frequency FBM macro tint (avoid multiplicative beats / separable sin grids).
 *
 * References: texture anti-tiling / stochastic blending (e.g. Terrain3D, layered terrain shaders).
 */
export function patchGroundMeshStandardMaterial(material, options = {}) {
  const detailMap = options.detailMap ?? null;

  if (detailMap) {
    material.defines = { ...material.defines, AELIRA_GROUND_DETAIL: "" };
  } else if (material.defines) {
    const next = { ...material.defines };
    delete next.AELIRA_GROUND_DETAIL;
    material.defines = next;
  }

  material.onBeforeCompile = (shader) => {
    if (detailMap) {
      shader.uniforms.groundDetailMap = { value: detailMap };
    }

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vGroundWorldPos;
varying float vGroundSlope;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
varying vec3 vGroundWorldPos;
varying float vGroundSlope;

float groundHash11( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

float groundVnoise( vec2 x ) {
	vec2 i = floor( x );
	vec2 f = fract( x );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = groundHash11( i + vec2( 0.0, 0.0 ) );
	float b = groundHash11( i + vec2( 1.0, 0.0 ) );
	float c = groundHash11( i + vec2( 0.0, 1.0 ) );
	float d = groundHash11( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

float groundFbm( vec2 x ) {
	float v = 0.0;
	float a = 0.52;
	mat2 m = mat2( 0.80, 0.60, -0.60, 0.80 );
	for ( int i = 0; i < 5; i++ ) {
		v += a * groundVnoise( x );
		x = m * x * 2.08 + vec2( 17.0, 41.0 );
		a *= 0.5;
	}
	return v;
}

#if defined( AELIRA_GROUND_DETAIL )
uniform sampler2D groundDetailMap;
#endif
`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vGroundWorldPos = worldPosition.xyz;
#else
	vGroundWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif
{
	vec3 wN = normalize( ( modelMatrix * vec4( objectNormal, 0.0 ) ).xyz );
	vGroundSlope = min( 1.0, max( 0.0, ( 1.0 - wN.y ) * 2.35 ) );
}`,
    );

    const organicMap = /* glsl */ `
#ifdef USE_MAP
	vec2 xz = vGroundWorldPos.xz;

	float w0 = groundFbm( xz * vec2( 0.084, 0.082 ) + vec2( 0.2, 1.7 ) );
	float w1 = groundFbm( xz * vec2( 0.079, 0.081 ) + vec2( 13.4, 0.8 ) );
	float w2 = groundFbm( xz * vec2( 0.091, 0.087 ) + vec2( 7.1, 19.2 ) );
	float ws = w0 + w1 + w2 + 1e-4;
	w0 /= ws;
	w1 /= ws;
	w2 /= ws;

	vec2 uv0 = vMapUv;
	mat2 r1 = mat2( 0.746, -0.665, 0.665, 0.746 );
	mat2 r2 = mat2( -0.158, 0.987, -0.987, -0.158 );
	vec2 uv1 = r1 * vMapUv + vec2( 0.17, 0.09 );
	vec2 uv2 = r2 * vMapUv + vec2( 0.31, -0.22 );

	vec4 t0 = texture2D( map, uv0 );
	vec4 t1 = texture2D( map, uv1 );
	vec4 t2 = texture2D( map, uv2 );
	#ifdef DECODE_VIDEO_TEXTURE
		t0 = sRGBTransferEOTF( t0 );
		t1 = sRGBTransferEOTF( t1 );
		t2 = sRGBTransferEOTF( t2 );
	#endif
	vec3 albedo = t0.rgb * w0 + t1.rgb * w1 + t2.rgb * w2;

	// Single low-frequency FBM only: two value-noise layers * multiplicative speckle
	// (sin*sin) both read as world-axis checkerboards when tiled over the ground.
	float macro = 0.93 + 0.12 * groundFbm( xz * vec2( 0.031, 0.029 ) + vec2( 2.7, 6.4 ) );
	albedo *= macro;

	float slope = vGroundSlope;
	float rockW = smoothstep( 0.22, 0.68, slope );
	float soilW = smoothstep( 0.06, 0.36, slope ) * ( 1.0 - rockW * 0.55 );
	vec3 rockTint = vec3( 0.42, 0.38, 0.34 );
	vec3 soilTint = vec3( 0.52, 0.46, 0.36 );
	albedo = mix( albedo, albedo * soilTint, soilW * 0.55 );
	albedo = mix( albedo, mix( albedo, rockTint, 0.72 ), rockW * 0.62 );

	float elev = vGroundWorldPos.y;
	float highW = clamp( ( elev - 9.5 ) * 0.055, 0.0, 0.38 );
	albedo = mix( albedo, albedo * vec3( 0.9, 0.93, 1.05 ), highW );

	float distXZ = length( vGroundWorldPos.xz - cameraPosition.xz );
	float aerial = clamp( ( distXZ - 55.0 ) / 620.0, 0.0, 1.0 );
	float lum = dot( albedo, vec3( 0.299, 0.587, 0.114 ) );
	vec3 mist = vec3( lum ) * vec3( 0.88, 0.9, 0.98 );
	albedo = mix( albedo, mist, aerial * 0.48 );

	#if defined( AELIRA_GROUND_DETAIL )
		vec2 dUv = xz * vec2( 0.26, 0.29 ) + xz.yx * vec2( 0.013, -0.017 ) + vec2( 4.7, -2.3 );
		vec4 det = texture2D( groundDetailMap, dUv );
		albedo *= mix( vec3( 1.0 ), det.rgb * 1.08, 0.42 );
	#endif

	diffuseColor *= vec4( albedo, t0.a );
#endif
`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      organicMap,
    );
  };

  material.customProgramCacheKey = () =>
    `aeliraGroundOrganicV10${detailMap ? "D" : ""}`;
}
