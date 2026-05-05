---
globs: src/api/**
---

# API Rules

These rules apply only to files under src/api/.

- Always validate inputs with Zod
- Return consistent { data, error } shapes
- No raw console.log â€” use the logger utility
