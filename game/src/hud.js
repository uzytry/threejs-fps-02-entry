// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, team
// list, killfeed, buy menu, banners and the one overlay panel. It never touches the
// simulation; main.js pushes numbers in and reads the play and buy callbacks out.
// Every setter caches its last value so the DOM is only written when something
// actually changed.
const COPY = {
  start: {
    title: 'CINDERFALL',
    copy: 'A round-based tactical FPS in an abandoned solar refinery. You are EMBER: push the lanes, plant the charge on the Reactor pad, or wipe ASH out. First to five rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'CINDERFALL',
    copy: 'Paused. The round waits for no one — click to get back in.',
    action: 'Click to resume',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(options = {}) {
  // In screenshot mode nothing ever fades: a capture taken seconds after the frame
  // was built must still show the killfeed, the hit marker and the toast.
  const persistent = !!options.persistent;
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('damage-vignette');
  const timerEl = $('timer');
  const bombStatus = $('bomb-status');
  const scoreEmber = $('score-ember');
  const scoreAsh = $('score-ash');
  const roundLabel = $('round-label');
  const healthNum = $('health-num');
  const healthBar = $('health-bar');
  const armourNum = $('armour-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyEl = $('money');
  const teamList = $('team-list');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');
  const bombChip = $('bomb-chip');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyRound = $('buy-round');
  const spectate = $('spectate');
  const toastEl = $('toast');

  let last = {};
  let hitTimer = 0;
  let toastTimer = 0;
  let teamRows = [];

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setHealth(hp, armour) {
      setText(healthNum, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(armourNum, 'arm', String(Math.max(0, Math.ceil(armour))));
      const pct = `${Math.max(0, Math.min(100, hp))}%`;
      if (last.hppct !== pct) {
        last.hppct = pct;
        healthBar.style.width = pct;
      }
      healthBar.classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve, name) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText(moneyEl, 'money', `$${value}`);
      setText(buyMoney, 'buymoney', `$${value}`);
    },
    setTimer(seconds, phase, fuse) {
      if (fuse !== null && fuse !== undefined) {
        setText(timerEl, 'timer', formatTime(fuse));
        timerEl.classList.add('danger');
        setText(bombStatus, 'bstat', 'BOMB LIVE');
      } else {
        setText(timerEl, 'timer', formatTime(seconds));
        timerEl.classList.remove('danger');
        setText(bombStatus, 'bstat', phase === 'buy' ? 'BUY PHASE' : '');
      }
    },
    setScore(ember, ash, round) {
      setText(scoreEmber, 'se', String(ember));
      setText(scoreAsh, 'sa', String(ash));
      setText(roundLabel, 'rnd', `ROUND ${round}`);
    },
    setBombChip(stateText) {
      if (stateText) {
        bombChip.hidden = false;
        setText(bombChip, 'chip', stateText);
      } else {
        bombChip.hidden = true;
      }
    },
    setTeamList(entries) {
      if (teamRows.length !== entries.length) {
        teamList.innerHTML = '';
        teamRows = entries.map((entry) => {
          const row = document.createElement('div');
          row.className = 'team-row';
          if (entry.isPlayer) row.classList.add('you');
          const name = document.createElement('span');
          name.className = 'team-name';
          name.textContent = entry.name;
          const bar = document.createElement('span');
          bar.className = 'team-hpbar';
          const fill = document.createElement('i');
          bar.appendChild(fill);
          const hp = document.createElement('span');
          hp.className = 'team-hp';
          row.append(name, bar, hp);
          teamList.appendChild(row);
          return { row, fill, hp };
        });
        last.teamKey = entries.map((e) => e.name).join(',');
      }
      entries.forEach((entry, i) => {
        const row = teamRows[i];
        const key = `${entry.hp}:${entry.alive}`;
        if (last[`team${i}`] === key) return;
        last[`team${i}`] = key;
        row.row.classList.toggle('dead', !entry.alive);
        row.fill.style.width = `${Math.max(0, entry.hp)}%`;
        row.hp.textContent = entry.alive ? String(Math.ceil(entry.hp)) : 'DOWN';
      });
    },
    killfeed(killer, victim, headshot) {
      const entry = document.createElement('div');
      entry.className = 'feed-entry';
      entry.innerHTML = '';
      const k = document.createElement('b');
      k.textContent = killer;
      const v = document.createElement('b');
      v.textContent = victim;
      entry.append(k, document.createTextNode(headshot ? '  ◉  ' : '  ✕  '), v);
      killfeed.prepend(entry);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      if (!persistent) setTimeout(() => entry.remove(), 6000);
    },
    toast(message) {
      toastEl.textContent = message;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      if (!persistent) toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
    },
    banner(main, sub) {
      bannerTitle.textContent = main;
      bannerSub.textContent = sub;
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    setCrosshairSpread(px) {
      const gap = Math.round(4 + px * 90);
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      if (!persistent) hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 160);
    },
    showPlant(progress, label) {
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
      plantLabel.textContent = label;
    },
    hidePlant() {
      plantBar.hidden = true;
    },
    showBuy(round) {
      buyMenu.hidden = false;
      if (round !== undefined) buyRound.textContent = String(round);
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    buyOpen() {
      return !buyMenu.hidden;
    },
    setBuyOwned(owned, grenades, armour) {
      for (const button of buyMenu.querySelectorAll('[data-buy]')) {
        const id = button.dataset.buy;
        const isOwned = id === 'grenade' ? grenades >= 2 : id === 'armour' ? armour >= 100 : !!owned[id];
        button.classList.toggle('owned', isOwned);
      }
    },
    showSpectate(name) {
      spectate.hidden = false;
      spectate.textContent = `Eliminated — spectating ${name}`;
    },
    hideSpectate() {
      spectate.hidden = true;
    },
    showOverlay(mode, extra) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'match' ? extra : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyMenu.addEventListener('click', (event) => {
        const button = event.target.closest('[data-buy]');
        if (button) handler(button.dataset.buy);
      });
    },
  };
}
