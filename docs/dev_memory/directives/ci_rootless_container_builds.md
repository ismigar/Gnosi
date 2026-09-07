# CI rootless container builds

## Objective

Keep the public Docker acceptance gate deterministic on the dedicated Linux
ARM64 rootless `nerdctl` runner without masking failed image builds.

## Procedure

1. Validate the Dockerfile, image tag, and context supplied by the workflow.
2. Read the build context's Git revision and allocate a unique build identifier.
   Require successful image listing and removal of an existing target CI tag;
   never force removal of an in-use image or ignore a failed removal.
3. Build with `org.opencontainers.image.revision` and `io.gnosi.ci.build-id` image
   labels recording that revision and unique invocation.
4. Inspect the target image after every build, including exit zero. Require both
   labels to match this invocation. A nonzero client exit can recover only after
   this verification; otherwise propagate the original build failure.
5. Continue to the real Compose startup, health, and persistence smoke test.

## Restrictions and lessons

- Do not ignore a nonzero container build merely because rootless imports can be
  slow. A previous target image must be removed successfully first, and the
  requested tag must carry this exact invocation's labels. Mere tag presence is
  not proof of a new image, even when the previous image has the same Git revision.
- Note: rootless `nerdctl` can print `context deadline exceeded` after BuildKit
  has completed, transferred, unpacked, and registered the requested image.
  Treat the inspected new image as the build result; the subsequent Compose
  smoke test remains the functional acceptance gate.
- Note: publication and ordering tests must assert the helper invocation with
  the exact Dockerfile and fresh CI tag, not the superseded raw `docker build`
  command. Otherwise the full suite fails after a correct workflow migration.
- Do not delete runner caches while a job is active. An installer can observe a
  cache before deletion and leave a later command without its executable.

## Verification

- Unit tests cover success, recoverable post-load failure, failed stale-tag
  removal/listing, wrong revision or nonce, malformed/missing metadata, failed
  inspection and an unrecoverable build failure. Mismatches fail after exit zero too.
- Ruff, strict mypy, workflow publication contracts, Docker capacity tests, and
  the real Docker Compose smoke job must pass.
