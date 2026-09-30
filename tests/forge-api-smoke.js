// Paste into a Foundry Script macro. Temporarily changes only this user's Dice Configuration.
// No chat messages, actor updates, module activation, or network publication.
const report = [];
const RollClass = foundry.dice.Roll;
const original = foundry.utils.deepClone(game.settings.get('core', 'diceConfiguration'));
let hook;
try {
  report.push(`Foundry ${game.version}; system ${game.system.id} ${game.system.version}`);
  report.push(`Dice Configuration: ${JSON.stringify(original)}`);
  await game.settings.set('core', 'diceConfiguration', { ...original, d6: 'manual', d20: 'manual' });
  for (const [formula, faces, values, expected] of [
    ['1d20 - 1', 20, [7], 6], ['2d20kh1 + 4', 20, [7, 17], 21],
    ['2d20kl1', 20, [7, 17], 7], ['2d6', 6, [5, 5], 10]
  ]) {
    const roll = new RollClass(formula);
    let fed = false, activeResolver;
    hook = Hooks.on('renderRollResolver', resolver => {
      if (resolver.roll !== roll || fed) return;
      fed = true; activeResolver = resolver;
      for (const value of values) {
        if (!resolver.registerResult('manual', `d${faces}`, value)) throw new Error(`Result rejected: ${formula}`);
      }
      resolver.element.requestSubmit(resolver.element.querySelector('button[type="submit"]'));
    });
    let timer;
    try {
      await Promise.race([roll.evaluate({allowInteractive: true}), new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('Resolver timeout')), 10000); })]);
      if (!fed || roll.total !== expected) throw new Error(`${formula}: ${roll.total}, expected ${expected}, fed=${fed}`);
      const message = await roll.toMessage({}, {create:false, messageMode:'self'});
      if (!message.whisper?.includes(game.user.id)) throw new Error('Self visibility was lost');
      report.push(`PASS ${formula} = ${roll.total}; self visibility`);
    } finally { clearTimeout(timer); Hooks.off('renderRollResolver', hook); hook = null; if (activeResolver) await activeResolver.close(); }
  }
  const data = new RollClass('2d6 + 1d20').toJSON();
  report.push(`Serialization sample: ${JSON.stringify(data)}`);
  for (const term of data.terms) {
    if (term.faces) { term.results = (term.faces === 6 ? [2,5] : [17]).map(result => ({result,active:true})); term.evaluated = true; }
  }
  data.evaluated = true; data.total = 24;
  const restored = RollClass.fromData(data);
  if (restored.total !== 24) throw new Error('Serialized physical total failed');
  report.push('PASS physical Roll.fromData = 24');
} catch (error) { report.push(`FAIL ${error.message}`); }
finally {
  if (hook) Hooks.off('renderRollResolver', hook);
  await game.settings.set('core', 'diceConfiguration', original);
  report.push('Original Dice Configuration restored.');
}
const content = document.createElement('pre'); content.textContent = report.join(String.fromCharCode(10));
new foundry.applications.api.DialogV2({ window:{title:'RollSight v14 API test results'}, content:content.outerHTML, buttons:[{action:'close',label:'Close'}] }).render(true);
