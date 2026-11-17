/**
 * Stateless counter-based 32-bit RNG. rand3(seed, frameOrIndex, channel) depends ONLY on its arguments - no hidden state - so any frame can be
 * sampled in any order with bit-identical results. The integer pipeline is the lowbias32 hash and is mirrored 1:1 by GLSL_COUNTER_RNG below
 * (uint arithmetic wraps modulo 2^32 in both JS via Math.imul/>>>0 and GLSL ES 3.00).
 */
const U32 = 4294967296;
export const u32 = (n: number): number => n >>> 0;

/** lowbias32 integer hash (Chris Wellons) */
export function hash32(x: number): number {
  x = u32(x);
  x = u32(x ^ (x >>> 16)); x = u32(Math.imul(x, 0x7feb352d));
  x = u32(x ^ (x >>> 15)); x = u32(Math.imul(x, 0x846ca68b));
  x = u32(x ^ (x >>> 16));
  return x;
}
/** 32-bit hash of (seed, frameOrIndex, channel). */
export function hash3(seed: number, frameOrIndex: number, channel: number): number {
  let h = hash32(seed);
  h = hash32(u32(h ^ u32(frameOrIndex)));
  h = hash32(u32(h + Math.imul(u32(channel), 0x9e3779b9)));
  return h;
}
/** Uniform float in [0, 1) from the top 32 bits (exactly representable: h / 2^32). */
export function rand3(seed: number, frameOrIndex: number, channel: number): number { return hash3(seed, frameOrIndex, channel) / U32; }
/** Uniform in [min, max). */
export const randRange = (seed: number, idx: number, channel: number, min: number, max: number): number => min + (max - min) * rand3(seed, idx, channel);
/** Standard normal via Box-Muller using two independent channels (deterministic, stateless). */
export function randNormal(seed: number, idx: number, channel: number): number {
  const u1 = Math.max(rand3(seed, idx, channel * 2), 1e-12), u2 = rand3(seed, idx, channel * 2 + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
/** Same integer function in GLSL ES 3.00 - paste into a fragment/vertex shader to get bit-identical values on the GPU. */
export const GLSL_COUNTER_RNG = `uint hash32(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;}
uint hash3(uint seed,uint idx,uint ch){uint h=hash32(seed);h=hash32(h^idx);h=hash32(h+ch*0x9e3779b9u);return h;}
float rand3(uint seed,uint idx,uint ch){return float(hash3(seed,idx,ch))/4294967296.0;}`;
