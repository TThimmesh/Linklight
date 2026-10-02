# Linklight — design notes

This file records why Linklight works the way it does. For setup and usage, see the
[README](README.md).

## Decisions

| Topic | Decision |
|---|---|
| Purpose | Document network closets as interactive 3D racks: what's installed, what's plugged in where, and photos of each port. It's built for IT teams and MSPs that look after many sites. |
| Name | Linklight, after the glowing link lights on documented ports. "PatchLight" was ruled out because PatchSee already sells a networking product with that name. |
| Hosting | One Firebase project per installation: Authentication, Cloud Firestore and Hosting. It's a static app with no server code. |
| Access | Invite-only: an admin creates accounts with sign-up turned off. Everyone who can sign in can edit everything. An optional email-domain lock lives in both `firestore.rules` and `config.js`. |
| Link lights | Documentation only. Green means a connection is documented on the port; amber is added when that connection powers a device over PoE and the port supports PoE. There is no live polling of equipment (yet). |
| Rendering | Real 3D (three.js via react-three-fiber). Rotate, zoom, fly to a device, snap to front, full screen. Only the front of gear is modeled; rear ports are drawn on the front. |
| Equipment | A shared model library. Faceplates are drawn from each model's specs (ports, rows, blocks, PoE, color), so adding a model needs no 3D modeling. |
| Racks | A site has any number of racks. Racks with the same "location" form a closet (MDF/IDF). Enclosure types: floor rack, wall cabinet, open frame / 2-post, shelf. |
| Hover card | Shows one hop: what the port connects to, the cable (color, label), speed/PoE, the far end's IP/MAC, notes and photos. |
| Patch panels | The back of a patch panel is a room / plate label on the port, not a tracked connection. |
| Photos | Downsized JPEGs, each in its own Firestore document. That keeps installations on Firebase's free Spark plan, which has no Cloud Storage. |
| Per-deployment config | `public/config.js`, `firestore.rules` and `.firebaserc` are gitignored, with `*.example` templates committed, so no installation's details end up in the repo. |
| Demo data | The `?demo` modes run only in development builds and are removed from production builds. The demo property is fictional. |
| Theme | Light and dark. It follows the OS until the user picks one, and the choice is remembered per browser. The 3D surroundings change with the theme; the racks stay dark so the lights pop. |
| Migration | An optional importer for teams moving from the original Patchwork app (Supabase). It reads the old data in the browser with the user's own Patchwork login, and can apply a local rack plan that arranges imported devices into racks. |

## Data model

See [README → Data model](README.md#data-model-cloud-firestore).

## Milestones

1. **Done:** sites, racks, the shared library with a live 3D preview, adding and placing
   equipment, link lights, cables, hover cards, the port editor, port photos.
2. **Done:** Firebase backend, invite-only access, the Patchwork importer with rack plans, light/dark
   mode, and full-screen 3D.
3. **Next:** a closets overview, multiple racks per closet in one scene, an off-rack panel by
   floor/room, and highlighting the port that feeds a device.
4. **Then:** graph view, table view, credentials view, findings, activity feed, global search.
5. **Later, maybe:** live link status, rear-of-rack modeling, floor plans, roles, printable
   elevations, a tablet mode.
