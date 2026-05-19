# Publishing Notes

This repository copy was generated from the working LawVoice project to produce a cleaner package for official publishing.

## Main cleanup decisions

- kept only project-relevant code, tests, profiles, setup scripts, and technical docs
- removed local environment secrets and runtime artifacts
- excluded vendor directories and local Python virtual environment contents
- excluded infrastructure and VPN helper files that are not part of the published prototype
- excluded presentation exports while keeping the thesis document
- left license selection for manual confirmation because the source workspace had no explicit `LICENSE` file

## Regeneration

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\create_official_publish_repo.ps1
```
