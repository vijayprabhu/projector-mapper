# Projector Mapper: working notes for Claude

## Branching workflow (required)

`main` is the default branch and is what GitHub Pages serves
(https://vijayprabhu.github.io/projector-mapper/), so every push to `main` goes live.

For every requested change:
1. Create a feature branch from the latest `origin/main`, named `feature/<short-description>`
   (or `fix/<short-description>` for bug fixes).
2. Commit the work there and push the branch.
3. Summarise the change and ask the user to confirm.
4. Only after the user explicitly confirms, merge the branch into `main` and push `main`.
   Never commit or push directly to `main` without that confirmation.

## Project layout

- `index.html`, `css/style.css`, `js/app.js`: the whole app. Plain HTML, CSS and JS with no build
  step and no dependencies. It must keep working when `index.html` is opened from disk (file://),
  so don't use ES modules or anything that needs a server.
- Test changes by serving the folder (`python3 -m http.server`) and driving it with Playwright.
