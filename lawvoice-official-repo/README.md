# LawVoice Official Repository

This directory is a cleaned publication copy of the LawVoice prototype repository.

## Scope

LawVoice is a voice-first legal literacy assistant prototype built on top of OpenAI Realtime infrastructure. This publication copy keeps the project code, core profiles, setup scripts, tests, and supporting technical documentation that are needed to review or reproduce the prototype.

## Included

- Node.js application source and static frontend
- LawVoice profiles and dialog logic
- Automated tests
- Setup scripts for Windows and WSL
- Core technical documentation
- Thesis copy in `docs/thesis/thesis.docx`

## Excluded

- Real secrets and local `.env`
- `node_modules`
- logs, caches, and generated runtime data
- local Python virtual environments
- backup dumps and unrelated admin or VPN tooling
- presentation export artifacts and other non-code working files

## Quick Start

1. Copy `.env.example` to `.env`
2. Fill in the required environment variables
3. Run `npm install`
4. Run `npm start`

## Notes

- This package is intended for official publication and review.
- If you need to rebuild it from the working repository, run `tools/create_official_publish_repo.ps1`.
- Confirm the publication license before pushing to a public remote, because the source workspace did not contain an explicit `LICENSE` file.
