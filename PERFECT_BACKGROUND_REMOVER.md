# PERFECT BACKGROUND REMOVER — LOCKED MASTER

Status: APPROVED by user on 2026-08-26.

Canonical source commit: `cc9615bec21857b77bb6c799f69a8466dfd75294`
Canonical preservation branch: `perfect-background-remover`

## Do not alter this branch
This branch is the approved reusable background-removal engine. Future PlantStudio/editor work should be developed elsewhere and must not modify this preserved implementation.

## Required behaviour
The remover treats the complete photographed foreground group as foreground and removes only the true background.

Keep:
- complete plant
- all leaves
- stems / petioles
- pot or container
- hand
- fingers
- arm
- physically connected/held foreground subject

Remove:
- wall
- room
- shelves
- floor
- scenery/background behind the subject

## Approved architecture
Foreground composition using the plant/object segmentation mask plus a separate human-preservation mask, with the human component merged when it is associated with/touching the plant foreground. The resulting masks are unioned before final alpha/edge processing.

This preserved branch is the version referred to as **Perfect Background Remover**. If another app needs the same removal behaviour, reuse this branch/commit rather than recreating or retuning the remover.