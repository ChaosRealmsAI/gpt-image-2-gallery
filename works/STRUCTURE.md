# Works Directory Structure

`works/` is the public display data layer. It uses a three-level model:

```text
topic 1 -> package N -> image N
```

Canonical path:

```text
works/topics/{theme-slug}/
├── topic.json
└── packages/
    └── {package_type}-{package_slug}/
        ├── package.json
        └── images/
            └── {image_slug}/
                ├── image.png
                └── meta.json
```

Generated public index:

```text
works/index.json        # built by npm run works:index, do not hand-edit
works/locales.json      # locale policy
works/tags.json         # tag label dictionary
works/schema/*.json     # public schema contracts
```

Rules:

- `topic` is only the creative/research subject from the todo item.
- `package` is one deliverable under that topic. A topic can have many single packages and many series packages.
- `package.type` is `single` or `series`.
- Use `single` for independent images under one topic. A package may contain many independent single images.
- Use `series` only when images intentionally share continuity or reference dependencies.
- `package.creative_direction` is required. It states what this package is doing and how it differs from existing packages under the same topic.
- `image` is the only layer that owns prompt and generation result.
- Every image directory contains one `meta.json`; it contains `image.png` only after generation succeeds.
- `meta.json.prompt` is the first field. Do not create `prompt.md`.
- `meta.json.status` is required. Use `prompted`, `running`, `done`, `failed`, or `skipped`.
- Failed images should include `generation.last_error` with a public-safe summary. Keep task ids, temporary URLs, and full logs in ignored `tmp/queue-runs/`.
- `meta.json.generation` is required. It must make the image runnable by a queue without extra decisions:
  - `order`: execution order inside the package.
  - `output.path`: repo-relative output image path.
  - `depends_on[]`: prior image refs, including `meta_path`, `image_path`, `ref_role`, and `required_status`.
  - `ref_urls[]`: runtime queue-injected URLs for `image2gen --ref`; local paths are not passed as refs, and temporary URLs should not be committed.
- Independent images use `generation.depends_on: []`; reference-dependent series images must declare their dependency graph.
- Do not put `single/` or `series/` directly under `works/topics/`. That belongs to package metadata and package slug.
- Public `meta.json` should only contain prompt, title, short description, image path, aspect ratio, tags, and refs. Do not put API task ids, temporary URLs, local absolute paths, scores, or internal evaluation notes in public works JSON.
- `title` and `description` are the English fallback. Every public `topic.json`, `package.json`, and `meta.json` also has `i18n` with at least `en` and `zh-CN`.
- `prompt` stays English only. Translate display copy, not the generation prompt.
- Every public object has `display.featured`, `display.sort_order`, and `display.audiences`.
- Every image `meta.json` has `display.alt.en` and `display.alt.zh-CN` for gallery cards, SEO, and accessibility.
- `tags` are stable English slugs. Human-readable labels live in `works/tags.json`.
- Frontends should read `works/index.json`, not recursively scan the directory at runtime.
- Frontends should only show images that are `status: done` and have `image.png`; prompted series tasks stay out of `works/index.json` until generated.
- Batch generation uses `npm run works:queue -- --concurrency 10`. The queue scans prompted `meta.json` files, starts ready tasks up to the concurrency limit, respects `generation.depends_on`, and marks each task `done` or `failed`.
- Health checks use `npm run works:scan -- --problems` or `npm run works:scan -- --strict`. Scan reports ready tasks, blocked dependencies, failed tasks, stale running tasks, missing outputs, skipped tasks, and invalid metadata.

Quality rule:

- A series package may keep the same subject and style internally.
- A different package under the same topic must change at least three of: subject, medium, composition, visual language, narrative angle.
- A single package is not just one extra image from an existing series.

Example in this directory:

```text
works/topics/high-speed-freeze/
├── topic.json
└── packages/
    └── single-impact-studies/
        ├── package.json
        └── images/
            ├── water-crown/
            ├── citrus-burst/
            └── powder-ring/
```

Commands:

```bash
npm run works:validate
npm run works:scan -- --problems
npm run works:index
npm run works:queue -- --concurrency 10
```
