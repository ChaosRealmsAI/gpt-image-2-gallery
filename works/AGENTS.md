# AGENTS.md · Works Data Workflow

This directory is public gallery data. It is not the private planning source.

## Scope

Open data here:

- `topics/**/topic.json`
- `topics/**/packages/**/package.json`
- `topics/**/packages/**/images/**/meta.json`
- generated `image.png`
- `tags.json`, `locales.json`, and schemas

Do not store API keys, task ids, temporary result URLs, private todo excerpts, run logs, or local absolute paths in `works/`.

## Directory Contract

Use this structure only:

```text
works/topics/{theme-slug}/
├── topic.json
└── packages/
    └── {single|series}-{package-slug}/
        ├── package.json
        └── images/{image-slug}/
            ├── meta.json
            └── image.png
```

Do not recreate legacy `works/A`, `works/S`, or tier folders.

## Writing Meta

Every image must have `meta.json`. The queue can run only if metadata is complete.

Rules:

- `prompt` is the first key and stays English.
- `status` is one of `prompted`, `running`, `done`, `failed`, or `skipped`.
- `generation.output.path` is the exact repo-relative path where `image.png` must be written.
- Independent images use `generation.depends_on: []`.
- Reference-dependent series images declare dependencies in `generation.depends_on`.
- `generation.ref_urls` must be `[]` in committed files; the queue injects temporary URLs at runtime.
- Every dependency object includes `id`, `meta_path`, `image_path`, `ref_role`, and `required_status: "done"`.
- Every public topic, package, and image includes `i18n.en` and `i18n.zh-CN`.
- Every image includes `display.alt.en` and `display.alt.zh-CN`.
- Tags are slugs; add labels to `works/tags.json`.

Series rule:

- Use `series` only for real continuity: same object, same character, same scene, same geometry, or a declared reference graph.
- If images are independent under one theme, use one `single` package with multiple image directories.

## Queue Runbook

Run from the repository root:

```bash
npm run works:validate
npm run works:scan -- --problems
npm run works:queue -- --dry-run --concurrency 10
npm run works:queue -- --concurrency 10
npm run works:scan -- --strict
npm run build
npm run check:public
```

For a single topic:

```bash
npm run works:queue -- --topic {topic-id} --concurrency 10
```

For failed retries:

```bash
npm run works:queue -- --retry failed --concurrency 10
```

For failed series retries where dependencies should be submitted again to create fresh runtime reference URLs:

```bash
npm run works:queue -- --retry failed --with-deps --concurrency 10
```

For interrupted runs where no queue is active:

```bash
npm run works:queue -- --retry running --concurrency 10
```

Both retry modes submit new `image2gen` jobs and ignore old task ids.

## Status Meaning

- `prompted`: ready for scan and queue if dependencies are satisfied.
- `running`: queue claimed it. If stale, retry with `--retry running`.
- `done`: `image.png` exists and can enter `works/index.json`.
- `failed`: queue or single-image generation failed. Check `generation.last_error`, then retry or revise prompt.
- `skipped`: intentionally not queued; leave it out of the gallery.

`works/index.json` must include only `done` images with real `image.png`.

## Failure Rules

- If dependency metadata is missing, fix paths instead of bypassing the dependency.
- If a dependency is not `done`, let the queue run it first.
- If a failed series task needs a runtime reference URL, use `--with-deps` to submit the dependency chain again.
- If output is missing but status is `done`, set status back to `prompted` or restore the image.
- If prompt quality caused failure, edit the prompt, clear `generation.last_error`, set `status: prompted`, then rerun.
- Never commit `generation.ref_urls`, task ids, temporary URLs, or `tmp/queue-runs` logs.

## Todo Boundary

`todo/atlas-todo.json` is outside this directory and ignored by git. Use it to choose themes and update private planning state, but never copy private scoring, evaluation, or source paths into public works files.
