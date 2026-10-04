# RollSight physical dice

Open Connect RollSight here or in the Settings sidebar to copy your code and set up physical dice.

## Set up this world

This world is not linked yet. Ask your GM to open Connect RollSight and choose Set up this world.

Copy this personal code into the desktop app. Select RollSight or Manual in Foundry Dice Configuration, then start a roll in Foundry.

Start your roll in Foundry, then send physical dice from the desktop app. Remote desktop roll requests are not supported.

## Accept dice for Manual rolls

Also fill native Manual prompts. Foundry keeps its normal controls and evaluates modifiers.

New roll requests automatically receive dice. If several prompts are open, the newest receives dice first; earlier prompts resume when it closes.

## Receive RollSight dice

Turn off to leave this session. Waiting rolls remain available in Foundry for manual completion.

## Use the browser extension

Receive local desktop results through the RollSight extension. Cloud reception is disabled in this mode.

This browser cannot coordinate tabs. Use only one Foundry tab per RollSight player.

## Post dice when no roll is waiting

Post plain physical dice using your current chat visibility. Start initiative, attacks and advantage in Foundry first.

## RollSight replay

Open the replay; select the image to view it full size.

## Reconnect to RollSight

RollSight could not connect. Open Connect RollSight in the Settings sidebar and choose Reconnect to RollSight.

Another tab is receiving RollSight dice for this player. Close it, then refresh this connection.

Dice were not accepted. Send whole-number values within each die’s range.

RollSight could not apply this delivery. Check the waiting roll before sending again.

## Automatic OBS scenes on combat turns

Use RollSight Foundry module 1.1.91 or newer and enable OBS Utils in the same world. These controls are separate from replay overlays.

In OBS, create your Foundry Browser Sources using the server address supplied by your GM: /game for the play view and /stream for the Stream user. Sign the /stream source into the user you will select as the OBS operator.

For every Foundry Browser Source, open Properties and set Page permissions to Advanced access or Full access. Permissions apply separately to /game and /stream. Refresh each source after changing them. Replay-only links do not need scene-control permissions.

Keep the /stream controller loaded across scene changes. Turn off Shut down source when not visible and reuse the same source in your scenes. With this browser-source connection, OBS Utils WebSocket and API access are not required.

As GM, open Game Settings → RollSight → Configure OBS turn scenes. Select the Stream user as OBS operator, then choose Refresh OBS scenes. Choose each actor and its OBS scene from the dropdowns. Optionally select scenes for unmapped NPC turns and the end of combat.

Choose Save OBS scenes, enable Switch OBS scenes on combat turns, and leave Pause automatic OBS scene switching unchecked. Unmapped player turns leave the current scene unchanged.

Mappings, the operator, and enabled/paused settings stay saved in this Foundry world. Stream may connect after the server starts. Once connected, it checks the current combat turn. The source must stay connected while automatic switching is needed.

Before streaming, advance a test combat turn and check the scene, then test pause and resume. If scenes are missing, check permissions on the /stream source, refresh its browser cache, and refresh the scene list. After renaming OBS scenes, select the new names and save again.

Foundry /stream chat hides RollSight replay controls and animations, regardless of the saved auto-expand preference. Roll results remain visible. Separate OBS replay overlay URLs still show replays, and regular Foundry players keep their own replay preference.
