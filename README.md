# LIFE (day by day)

A personal task manager with one-off tasks, daily habits, ongoing projects, and a treat-yourself randomizer. Built with Node.js/Express and vanilla JS. Runs locally.

## Setup

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Architecture

```
server.js          — Express backend, reads/writes tasks.json
public/
  index.html       — Single-page app with 4 views (main, Olympus, Treats)
  app.js           — Vanilla JS frontend logic
  style.css        — Full stylesheet (Prada-inspired plum + sage palette)
tasks.json         — All persistent data (auto-created on first run)
```

## Task categories

### One-off
Simple tasks you do once. Checking one off moves it to the **Done** section at the bottom of the main view. Done items auto-clear after **7 days**.

### Habits
Recurring daily tasks. Check them off each day — they auto-reset at midnight. Includes things like stretching, foam rolling, journaling (Hobochini).

### Projects
Ongoing work with a deliberate **slide-to-ascend** interaction (no casual checkmarks). Drag the slider all the way across to complete a project. Completed projects move to **Mount Olympus**.

### Treats
Pleasurable things stored in a separate repository (accessible via the Treats button). These have a **20% chance** of appearing in the Surprise me randomizer. If all tasks are done for the day, you get a treat guaranteed.

## Special views

### Mount Olympus
A trophy room for completed projects. Each entry gets a date and an auto-generated reflection in an alleged Pynchon voice (randomly selected from ~24 templates). Accessed via the "Mount Olympus" button in the header. Projects can be restored back to active with the undo link.

### Treats
A repository of nice things you can add to, edit, or delete. Accessed via the "Treats" button in the header. These feed into the Surprise me randomizer.

### Done section
Faded mini-list at the bottom of the main view showing recently completed one-off tasks. Auto-clears after 7 days. Items can be restored to one-off with the undo link.

## Surprise me

The randomizer picks a random uncompleted task from one-offs and habits (not projects — those are intentional). 20% chance of pulling a treat instead. Results appear in a centered overlay with a slide-up animation, category label, and re-spin option.

## Design

Prada FW21-inspired palette:
- **Background:** deep plum (`#2d0a2e`)
- **Text:** warm ivory (`#f0e8e0`)
- **Accent:** sage green (`#b5c99a`) — buttons, category headers, sliders, checkmarks
- **Typography:** Instrument Serif for headings, Inter for body
- **Geometry:** square corners throughout (no border-radius), uppercase tracking on labels
- Mobile-responsive with touch-friendly controls

## Data storage

All data lives in `tasks.json` in the project root. The file is auto-created with seed data on first run. Structure:

```json
{
  "oneOff": [],
  "habits": [],
  "projects": [],
  "treats": [],
  "done": [],
  "olympus": [],
  "nextId": 500
}
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | Get all tasks (also resets habits if date changed, clears old done items) |
| POST | `/api/tasks/:category` | Add a task to a category |
| PUT | `/api/tasks/:category/:id` | Update a task (toggle done, edit text) |
| DELETE | `/api/tasks/:category/:id` | Delete a task |
| POST | `/api/restore/:category/:id` | Restore a done/olympus item back to its original category |
| GET | `/api/random` | Get a random uncompleted task (20% treat chance) |
