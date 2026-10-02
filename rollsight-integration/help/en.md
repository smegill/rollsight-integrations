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

## Optional OBS combat scenes

In Game Settings → RollSight, choose **Configure OBS turn scenes**. Select the Foundry user signed into your OBS Utils `/stream` Browser Source. Map actors to exact existing OBS scene names, and optionally choose scenes for unmapped NPC turns and combat ending. Unmapped player turns leave the scene unchanged. Save, then enable **Switch OBS scenes on combat turns**. Use **Pause automatic OBS scene switching** to keep manual control; save to resume on the current turn.

This uses OBS Utils’ existing connection or the OBS Browser Source scene-control permission. No second OBS password or desktop update is required. Use one controller source and a secure Foundry URL (HTTPS or localhost). Keep that source loaded when changing OBS scenes, so it can continue receiving turns. If OBS Utils does not expose the required API, update it before enabling this feature. A missing scene or disconnected OBS connection leaves the current scene in place; check the scene spelling and OBS Utils connection. Test in your scene collection before streaming live.
