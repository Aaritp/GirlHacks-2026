# Health timer integration point

Shared-backend owner: implement after Cosmos persistence exists. Base health is
`clamp(1 - daysSinceLastActivity / 7, 0, 1)`; below 0.3 displays wilted.
Agree on the deadline acceleration and completed-seed behavior before enabling a timer.
No background mutation is scheduled in the foundation.
