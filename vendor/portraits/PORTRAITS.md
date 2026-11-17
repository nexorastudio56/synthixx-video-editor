# Curated Tech Leader Portraits

This directory holds verified high-resolution photographic portraits of tech leaders
used by `engine3/intelligence/entityResolver.ts` for real-entity cutouts.

## Required files (1000×1000 minimum, PNG preferred, genuine photographs):

| File | Person | Notes |
|------|--------|-------|
| `jensen_huang.png` | Jensen Huang (NVIDIA CEO) | Genuine photo, sharp, front-facing |
| `elon_musk.png` | Elon Musk (Tesla/SpaceX/xAI CEO) | Genuine photo, sharp, front-facing |
| `sam_altman.png` | Sam Altman (OpenAI CEO) | Genuine photo, sharp, front-facing |
| `satya_nadella.png` | Satya Nadella (Microsoft CEO) | Genuine photo, sharp, front-facing |
| `mark_zuckerberg.png` | Mark Zuckerberg (Meta CEO) | Genuine photo, sharp, front-facing |

## Offline fallback

When real photos are unavailable (sandboxed/no network), the resolver generates
high-resolution placeholder cutouts (initials on a brand-tinted circular disc)
so the pipeline never breaks. Place genuine photos at the paths above to replace
the fallbacks — the resolver prefers a real file over a generated placeholder.

## Resolution pipeline

For each portrait:
1. Load source image (1000×1000+ min).
2. Center-crop to square at max resolution.
3. Apply sharp circular mask + edge refinement (anti-aliased alpha edge).
4. Output as `cache/cutouts/<slug>.png` with verified alpha channel.

No cartoons, no invented graphics — real photographs only.