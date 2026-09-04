# CI rootless container builds

## Objective

Keep the public Docker acceptance gate deterministic on the dedicated Linux
ARM64 rootless `nerdctl` runner without masking failed image builds.

## Procedure

1. Validate the Dockerfile, image tag, and context supplied by the workflow.
2. Remove the target CI tag before each build so no earlier image can satisfy a
   post-build check.
3. Run the normal Docker-compatible build command and accept exit zero.
4. If the client exits nonzero, inspect the newly created target tag. Accept the
   image only when inspection succeeds; otherwise propagate the original build
   failure.
5. Continue to the real Compose startup, health, and persistence smoke test.

## Restrictions and lessons

- Do not ignore a nonzero container build merely because rootless imports can be
  slow. A previous target image must be removed first, and the requested tag
  must exist after that exact invocation.
- Note: rootless `nerdctl` can print `context deadline exceeded` after BuildKit
  has completed, transferred, unpacked, and registered the requested image.
  Treat the inspected new image as the build result; the subsequent Compose
  smoke test remains the functional acceptance gate.
- Do not delete runner caches while a job is active. An installer can observe a
  cache before deletion and leave a later command without its executable.

## Verification

- Unit tests cover success, recoverable post-load failure, stale-tag removal,
  and an unrecoverable build failure.
- Ruff, strict mypy, workflow publication contracts, Docker capacity tests, and
  the real Docker Compose smoke job must pass.
