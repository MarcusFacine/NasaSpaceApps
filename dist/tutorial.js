import { addDictionary, bindLanguageSwitch, onLangChange, t } from './i18n.js';

addDictionary({
  pt: { 'tut.title': 'Tutorial ilustrado · Horisite', 'tut.print': 'Imprimir guia', 'tut.skip': 'Pular para o tutorial' },
  en: { 'tut.title': 'Illustrated tutorial · Horisite', 'tut.print': 'Print guide', 'tut.skip': 'Skip to the tutorial' }
});
const title = () => { document.title = t('tut.title'); };
bindLanguageSwitch();
onLangChange(title);
title();
document.getElementById('printGuide')?.addEventListener('click', () => window.print());
