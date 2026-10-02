# RollSight — Foundry VTT

- [English](help/en.md)
- [Español](help/es.md)
- [Français](help/fr.md)
- [Português](help/pt.md)
- [中文](help/zh.md)
- [हिन्दी](help/hi.md)
- [বাংলা](help/bn.md)
- [العربية](help/ar.md)
- [اردو](help/ur.md)
- [Bahasa Indonesia](help/id.md)

### Optional OBS combat scenes

Game Settings → RollSight → **Configure OBS turn scenes** maps actors to existing OBS scenes. Choose the Foundry user in the OBS Utils `/stream` Browser Source, save mappings and optional NPC/end scenes, then enable **Switch OBS scenes on combat turns**. This is off by default and requires OBS Utils' public OBS-mode API. It uses OBS Utils' existing WebSocket client, or the Browser Source scene-control API when permitted. No desktop connection or second OBS password is needed.

Keep the controller source loaded across scene changes and use one OBS operator installation. Browser locks coordinate duplicate sources in the same browser context. The world-wide pause setting preserves manual control. Localized instructions are in `help/<language>.md`. Source tests pass, but a live OBS session and module publication are still required.
