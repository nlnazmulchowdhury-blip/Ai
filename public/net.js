(() => {
  const canvas = document.getElementById('net');
  const stage = document.getElementById('stage');
  const cmd = document.querySelector('.cmd');
  const labelsHost = document.getElementById('net-labels');
  if (!canvas || !stage || !window.THREE) return;

  const THREE = window.THREE;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  const world = new THREE.Group();
  scene.add(world);

  const target = new THREE.Vector3(-0.9, -0.45, 0);
  const orbit = { yaw: 0, pitch: 0.26, zoom: 1, baseDist: 9.3 };
  const pointer = new THREE.Vector2(-2, -2);
  const raycaster = new THREE.Raycaster();
  const tmpVec = new THREE.Vector3();

  const FIXED_ANCHORS = {
    route: [-3.0, 1.15, -1.4],
    intake: [-3.8, -0.5, 0.8],
    think: [0.0, 1.55, -0.5],
    act: [3.0, -0.4, 1.1],
    forge: [0.4, -1.15, 2.0]
  };
  const USER_ID = '__you';
  const USER_POS = [-4.7, 0.7, 0.4];

  let width = 0;
  let height = 0;
  let view = { compact: false, scale: 1, cmdTop: 300, hud: null };
  let nodes = [];
  let nodeById = new Map();
  let links = [];
  let packets = null;
  let hitMeshes = [];
  let hoveredId = null;
  let connected = new Set();
  let sceneSig = '';
  let running = false;
  let raf = 0;
  let lastFrame = performance.now();
  let dragging = false;
  let dragMoved = 0;
  let dragStart = { x: 0, y: 0, yaw: 0, pitch: 0 };

  const glowCache = new Map();
  function glowTexture() {
    if (glowCache.has('w')) return glowCache.get('w');
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.5)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    glowCache.set('w', tex);
    return tex;
  }

  const POLAR = new THREE.PolarGridHelper(4.2, 8, 5, 64, 0x1f4652, 0x173039);
  POLAR.position.y = -1.55;
  POLAR.material.transparent = true;
  POLAR.material.opacity = 0.16;
  POLAR.material.depthWrite = false;
  scene.add(POLAR);

  const dustCount = window.innerWidth < 620 ? 90 : 170;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPos[i * 3] = (Math.random() - 0.5) * 13;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 7;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 9;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0x7ab8ff,
      size: 0.032,
      map: glowTexture(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  scene.add(dust);

  scene.add(new THREE.AmbientLight(0x8899aa, 1.1));
  const keyLight = new THREE.PointLight(0x7ab8ff, 22, 30, 2);
  keyLight.position.set(-5, 5, 7);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight(0xf5a524, 16, 26, 2);
  warmLight.position.set(5, -2, 5);
  scene.add(warmLight);

  function groupAnchors(bots) {
    const groups = new Map();
    for (const bot of bots) {
      if (!groups.has(bot.group)) groups.set(bot.group, []);
      groups.get(bot.group).push(bot);
    }
    const anchors = new Map();
    const extras = [];
    for (const groupId of groups.keys()) {
      if (FIXED_ANCHORS[groupId]) anchors.set(groupId, new THREE.Vector3(...FIXED_ANCHORS[groupId]));
      else extras.push(groupId);
    }
    extras.forEach((groupId, i) => {
      const angle = -2.2 + (i / Math.max(1, extras.length)) * Math.PI * 2;
      const radius = 2.85 + (i % 2) * 0.45;
      anchors.set(
        groupId,
        new THREE.Vector3(
          Math.cos(angle) * radius,
          (i % 3) * 0.62 - 0.62,
          Math.sin(angle) * radius * 0.66
        )
      );
    });
    return { groups, anchors };
  }

  function nextDefinitions(bots, providers) {
    const { groups, anchors } = groupAnchors(bots);
    const defs = [];
    const workerIds = new Map();
    for (const [groupId, list] of groups) {
      const anchor = anchors.get(groupId) || new THREE.Vector3();
      const workers = list.filter((bot) => bot.role !== 'boss');
      const bosses = list.filter((bot) => bot.role === 'boss');
      const orbitPhase = (groupId.split('').reduce((n, ch) => n + ch.charCodeAt(0), 0) % 31) / 10;
      workers.forEach((bot, i) => {
        const n = Math.max(1, workers.length);
        const angle = n === 1 ? 0.6 : (i / n) * Math.PI * 2 + orbitPhase;
        const radius = n === 1 ? 0.12 : 0.4 + n * 0.055;
        const y = n === 1 ? -0.32 : -0.3 + (i % 2) * 0.14;
        defs.push({
          id: bot.id,
          label: bot.name || bot.id,
          provider: providers?.[bot.provider]?.label || bot.provider,
          colorHex: providers?.[bot.provider]?.color || '#7ab8ff',
          group: groupId,
          isBoss: false,
          isUser: false,
          status: bot.status || 'idle',
          pos: new THREE.Vector3(
            anchor.x + Math.cos(angle) * radius,
            anchor.y + y,
            anchor.z + Math.sin(angle) * radius * 0.8
          )
        });
      });
      bosses.forEach((bot, i) => {
        defs.push({
          id: bot.id,
          label: bot.name || bot.id,
          provider: providers?.[bot.provider]?.label || bot.provider,
          colorHex: providers?.[bot.provider]?.color || '#7ab8ff',
          group: groupId,
          isBoss: true,
          isUser: false,
          status: bot.status || 'idle',
          pos: new THREE.Vector3(anchor.x + i * 0.45, anchor.y + 0.68, anchor.z - 0.08)
        });
      });
      workerIds.set(groupId, workers.map((bot) => bot.id));
    }
    defs.push({
      id: USER_ID,
      label: 'you',
      provider: '',
      colorHex: '#a8c8ff',
      group: '',
      isBoss: false,
      isUser: true,
      status: 'idle',
      pos: new THREE.Vector3(...USER_POS)
    });
    return { defs, workerIds };
  }

  function linkDefinitions(defs, workerIds) {
    const byId = new Map(defs.map((d) => [d.id, d]));
    const linksDef = [];
    const seen = new Set();
    const add = (aId, bId, kind = 'flow') => {
      const a = byId.get(aId);
      const b = byId.get(bId);
      if (!a || !b || a.id === b.id) return;
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      linksDef.push({ a, b, kind });
    };
    const pick = (group) => (workerIds.get(group) || []).map((id) => byId.get(id)).filter(Boolean);
    const route = pick('route');
    const intake = pick('intake');
    const think = pick('think');
    const act = pick('act');
    const sources = route.length ? route : defs.filter((d) => !d.isBoss && !d.isUser).slice(0, 1);
    for (const bot of sources) add(USER_ID, bot.id, 'user');
    for (const from of route) for (const to of [...intake, ...think, ...act]) add(from.id, to.id);
    for (const from of intake) for (const to of think) add(from.id, to.id);
    for (const from of think) for (const to of act) add(from.id, to.id);
    for (const boss of defs.filter((d) => d.isBoss)) {
      for (const worker of workerIds.get(boss.group) || []) add(boss.id, worker, 'boss');
    }
    return linksDef;
  }

  function makeHalo(colorHex, isBoss) {
    const mat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: isBoss ? 0.7 : 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(isBoss ? 1.5 : 0.95);
    return sprite;
  }

  function createNode(def) {
    const root = new THREE.Group();
    root.position.copy(def.pos);
    const accent = def.isBoss ? '#f5a524' : def.colorHex;
    const color = new THREE.Color(def.isBoss ? '#f5a524' : def.colorHex);

    const coreMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.15,
      roughness: 0.32,
      metalness: 0.15,
      transparent: true,
      opacity: 1
    });
    const coreGeo = def.isUser
      ? new THREE.SphereGeometry(0.115, 16, 16)
      : def.isBoss
        ? new THREE.OctahedronGeometry(0.28, 0)
        : new THREE.SphereGeometry(0.18, 20, 20);
    const core = new THREE.Mesh(coreGeo, coreMat);
    root.add(core);

    let cage = null;
    if (def.isBoss) {
      cage = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.38, 0),
        new THREE.MeshBasicMaterial({
          color: 0xf5a524,
          wireframe: true,
          transparent: true,
          opacity: 0.5,
          depthWrite: false
        })
      );
      root.add(cage);
    }

    const halo = makeHalo(accent, def.isBoss);
    root.add(halo);

    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(accent),
      transparent: true,
      opacity: def.isUser ? 0.5 : def.isBoss ? 0.28 : 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.isBoss ? 0.42 : def.isUser ? 0.16 : 0.26, def.isBoss ? 0.45 : def.isUser ? 0.175 : 0.272, 56),
      ringMat
    );
    root.add(ring);

    const hitMat = new THREE.MeshBasicMaterial();
    hitMat.visible = false;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(def.isBoss ? 0.56 : def.isUser ? 0.3 : 0.44, 8, 8), hitMat);
    hit.userData.nodeId = def.id;
    root.add(hit);

    world.add(root);

    const el = document.createElement('div');
    el.className = `nl${def.isBoss ? ' boss' : ''}${def.isUser ? ' you' : ''}`;
    const name = document.createElement('span');
    name.className = 'nl-name';
    name.textContent = def.label;
    const sub = document.createElement('span');
    sub.className = 'nl-sub';
    el.append(name, sub);
    if (labelsHost) labelsHost.append(el);

    return {
      id: def.id,
      label: def.label,
      provider: def.provider,
      colorHex: def.colorHex,
      accent,
      group: def.group,
      isBoss: def.isBoss,
      isUser: def.isUser,
      status: def.status,
      base: def.pos.clone(),
      phase: Math.random() * Math.PI * 2,
      root,
      core,
      coreMat,
      cage,
      halo,
      ring,
      ringMat,
      hit,
      el,
      nameEl: name,
      subEl: sub,
      haloBase: def.isBoss ? 1.5 : def.isUser ? 1.05 : 0.95
    };
  }

  function paintNode(node) {
    const busy = node.status === 'busy';
    const statusColor =
      node.status === 'busy'
        ? '#f5a524'
        : node.status === 'error'
          ? '#f87171'
          : node.status === 'login'
            ? '#7ab8ff'
            : node.accent;
    node.coreMat.color.set(node.isBoss ? '#f5a524' : node.colorHex);
    node.coreMat.emissive.set(node.isBoss ? '#f5a524' : node.colorHex);
    node.coreMat.emissiveIntensity = busy ? 2.1 : 1.15;
    node.halo.material.color.set(node.accent);
    node.halo.material.opacity = busy ? 0.9 : node.isBoss ? 0.55 : 0.38;
    node.ringMat.color.set(statusColor);
    node.ringMat.opacity = busy ? 0.95 : node.status === 'error' || node.status === 'login' ? 0.7 : node.isUser ? 0.5 : node.isBoss ? 0.28 : 0.18;
    node.nameEl.textContent = node.label;
    const sub = node.isUser
      ? 'YOU'
      : node.isBoss
        ? `BOSS · ${String(node.provider || '').toUpperCase()}`
        : busy
          ? `BUSY · ${String(node.provider || '').toUpperCase()}`
          : String(node.provider || '').toUpperCase();
    node.subEl.textContent = sub;
    node.el.classList.toggle('busy', busy);
    node.el.classList.toggle('error', node.status === 'error');
    node.el.classList.toggle('login', node.status === 'login');
    node.el.style.setProperty('--c', node.colorHex);
  }

  function nodeSignature(bots, providers) {
    return JSON.stringify(
      bots.map((b) => [b.id, b.name, b.group, b.role, b.provider, providers?.[b.provider]?.label, providers?.[b.provider]?.color])
    );
  }

  function disposeObject(obj) {
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map && child.material.map !== glowTexture()) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }

  function rebuildScene(bots, providers) {
    const { defs, workerIds } = nextDefinitions(bots, providers);
    const keep = new Set(defs.map((d) => d.id));
    for (const node of [...nodes]) {
      if (keep.has(node.id)) continue;
      world.remove(node.root);
      disposeObject(node.root);
      node.el.remove();
      nodes = nodes.filter((n) => n !== node);
    }
    nodeById = new Map(nodes.map((n) => [n.id, n]));
    for (const def of defs) {
      const existing = nodeById.get(def.id);
      if (existing) {
        existing.base.copy(def.pos);
        existing.label = def.label;
        existing.provider = def.provider;
        existing.colorHex = def.colorHex;
        existing.status = def.status;
        existing.group = def.group;
        existing.accent = def.isBoss ? '#f5a524' : def.colorHex;
        existing.haloBase = def.isBoss ? 1.5 : def.isUser ? 1.05 : 0.95;
        paintNode(existing);
      } else {
        const node = createNode(def);
        paintNode(node);
        nodes.push(node);
        nodeById.set(node.id, node);
      }
    }
    nodes = defs.map((d) => nodeById.get(d.id)).filter(Boolean);
    hitMeshes = nodes.filter((n) => !n.isUser).map((n) => n.hit);

    for (const link of links) {
      world.remove(link.line);
      link.line.geometry.dispose();
      link.line.material.dispose();
    }
    links = [];
    for (const def of linkDefinitions(defs, workerIds)) {
      const a = nodeById.get(def.a.id);
      const b = nodeById.get(def.b.id);
      if (!a || !b) continue;
      const color = def.kind === 'boss' ? 0xf5a524 : def.kind === 'user' ? 0xa8c8ff : 0x7ab8ff;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const dashed = def.kind === 'boss';
      const material = dashed
        ? new THREE.LineDashedMaterial({
            color,
            transparent: true,
            opacity: 0.3,
            dashSize: 0.12,
            gapSize: 0.14,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        : new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: def.kind === 'user' ? 0.36 : 0.22,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          });
      const line = new THREE.Line(geometry, material);
      world.add(line);
      links.push({
        a,
        b,
        kind: def.kind,
        line,
        dashed,
        baseOpacity: def.kind === 'user' ? 0.36 : def.kind === 'boss' ? 0.3 : 0.22,
        color: new THREE.Color(color)
      });
    }

    if (packets) {
      world.remove(packets);
      packets.geometry.dispose();
      packets.material.dispose();
    }
    const perLink = 2;
    const count = links.length * perLink;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const packetData = [];
    let idx = 0;
    for (const link of links) {
      for (let k = 0; k < perLink; k += 1) {
        packetData.push({ link, t: (k * 0.5 + Math.random() * 0.4) % 1, speed: 0.1 + Math.random() * 0.18 });
        colors[idx * 3] = link.color.r;
        colors[idx * 3 + 1] = link.color.g;
        colors[idx * 3 + 2] = link.color.b;
        idx += 1;
      }
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const pmat = new THREE.PointsMaterial({
      size: 0.11,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    packets = new THREE.Points(pgeo, pmat);
    packets.userData.data = packetData;
    packets.visible = !reduceMotion;
    world.add(packets);

    sceneSig = nodeSignature(bots, providers);
    if (hoveredId && !nodeById.has(hoveredId)) {
      hoveredId = null;
      connected = new Set();
    }
    updateHoverClasses();
  }

  function updateHoverClasses() {
    for (const node of nodes) {
      const dim = Boolean(hoveredId && node.id !== hoveredId && !connected.has(node.id));
      node.el.classList.toggle('hover', node.id === hoveredId);
      node.el.classList.toggle('dim', dim);
    }
  }

  function setHover(id) {
    if (id === hoveredId) return;
    hoveredId = id;
    connected = new Set();
    if (id) {
      for (const link of links) {
        if (link.a.id === id) connected.add(link.b.id);
        if (link.b.id === id) connected.add(link.a.id);
      }
    }
    updateHoverClasses();
    canvas.style.cursor = id ? 'pointer' : dragging ? 'grabbing' : 'grab';
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    return hits.length ? hits[0].object.userData.nodeId : null;
  }

  function layoutView() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const compact = width < 620;
    view = {
      compact,
      scale: compact ? 0.82 : 0.86,
      cmdTop: height - ((cmd?.offsetHeight || 140) + 26),
      hud: null,
      cmd: null
    };
    const hud = stage.querySelector('.stage-hud');
    if (hud) {
      const hr = hud.getBoundingClientRect();
      view.hud = { left: hr.left - rect.left, right: hr.right - rect.left, top: hr.top - rect.top, bottom: hr.bottom - rect.top };
    }
    if (cmd) {
      const cr = cmd.getBoundingClientRect();
      view.cmd = { left: cr.left - rect.left, right: cr.right - rect.left, top: cr.top - rect.top };
    }
    world.scale.setScalar(view.scale);
    camera.fov = compact ? 52 : 42;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    orbit.baseDist = compact ? 11.4 : 9.3;
    target.set(compact ? -0.45 : 0.45, compact ? -0.35 : -1.0, 0);
  }

  function applyCamera(t) {
    const drift = reduceMotion || dragging ? 0 : Math.sin(t * 0.13) * 0.16;
    const yaw = orbit.yaw + drift;
    const dist = orbit.baseDist * orbit.zoom;
    const cp = Math.cos(orbit.pitch);
    camera.position.set(
      target.x + Math.sin(yaw) * cp * dist,
      target.y + Math.sin(orbit.pitch) * dist,
      target.z + Math.cos(yaw) * cp * dist
    );
    camera.lookAt(target);
  }

  function updateLabels() {
    if (!labelsHost) return;
    labelsHost.style.width = `${width}px`;
    labelsHost.style.height = `${height}px`;
    const items = [];
    for (const node of nodes) {
      node.el.classList.toggle('slim', view.compact && node.id !== hoveredId);
      node.root.getWorldPosition(tmpVec);
      tmpVec.project(camera);
      const x = (tmpVec.x * 0.5 + 0.5) * width;
      const y = (-tmpVec.y * 0.5 + 0.5) * height;
      const behind = tmpVec.z < -1 || tmpVec.z > 1;
      const compactHide =
        width < 470 && node.id !== hoveredId && !(node.isBoss || node.isUser || node.status !== 'idle');
      const dim = Boolean(hoveredId && node.id !== hoveredId && !connected.has(node.id));
      const w = node.el.offsetWidth || 64;
      const h = node.el.offsetHeight || 20;
      const candidate = (above) => {
        const top = above ? y - 18 - h : y + 13;
        const bottom = top + h;
        const half = w / 2;
        const cx = Math.min(width - 8 - half, Math.max(8 + half, x));
        const inHud =
          view.hud && cx > view.hud.left - 10 && cx < view.hud.right + 10 && bottom > view.hud.top - 10 && top < view.hud.bottom + 6;
        const overCmd =
          view.cmd && bottom > view.cmd.top - 2 && cx + half > view.cmd.left && cx - half < view.cmd.right;
        const off = Math.abs(cx - x) > 18 || top < 24 || bottom > height - 4;
        return { above, x: cx, top, bottom, left: cx - half, right: cx + half, ok: !(behind || compactHide || inHud || off || overCmd) };
      };
      const nearBottom = y > view.cmdTop - 26;
      const preferAbove = nearBottom || ((node.isBoss || node.isUser) && y > 84);
      items.push({
        node,
        x,
        y,
        dim,
        shown: !behind && !compactHide,
        cands: [candidate(preferAbove), candidate(!preferAbove)],
        rank:
          (node.id === hoveredId ? 100 : 0) +
          (node.isUser ? 70 : node.isBoss ? 60 : 20) +
          (node.status !== 'idle' ? 15 : 0)
      });
    }
    items.sort((a, b) => b.rank - a.rank);
    const placed = [];
    for (const item of items) {
      let chosen = null;
      if (item.shown) {
        for (const cand of item.cands) {
          if (!cand.ok) continue;
          const clash = placed.some(
            (r) => cand.left < r.right + 3 && cand.right > r.left - 3 && cand.top < r.bottom + 2 && cand.bottom > r.top - 2
          );
          if (!clash) {
            chosen = cand;
            break;
          }
        }
      }
      if (chosen) placed.push(chosen);
      item.node.el.style.opacity = String(chosen ? (item.dim ? 0.24 : 1) : 0);
      const tx = chosen ? chosen.x : item.x;
      const dy = chosen ? chosen.top : item.y + 13;
      item.node.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) translate(-50%, 0)`;
    }
  }

  function updateLines(dt) {
    for (const link of links) {
      const pa = link.a.root.position;
      const pb = link.b.root.position;
      const attr = link.line.geometry.getAttribute('position');
      attr.setXYZ(0, pa.x, pa.y, pa.z);
      attr.setXYZ(1, pb.x, pb.y, pb.z);
      attr.needsUpdate = true;
      if (link.dashed) link.line.computeLineDistances();
      const active = hoveredId && (link.a.id === hoveredId || link.b.id === hoveredId);
      const dim = hoveredId && !active;
      link.line.material.opacity = active ? 0.85 : dim ? 0.05 : link.baseOpacity;
    }
    if (!packets || reduceMotion) return;
    const data = packets.userData.data;
    const attr = packets.geometry.getAttribute('position');
    const dimAll = hoveredId ? 0.4 : 0.95;
    packets.material.opacity += (dimAll - packets.material.opacity) * Math.min(1, dt * 4);
    for (let i = 0; i < data.length; i += 1) {
      const item = data[i];
      item.t = (item.t + dt * item.speed) % 1;
      const a = item.link.a.root.position;
      const b = item.link.b.root.position;
      attr.setXYZ(i, a.x + (b.x - a.x) * item.t, a.y + (b.y - a.y) * item.t, a.z + (b.z - a.z) * item.t);
    }
    attr.needsUpdate = true;
  }

  function animate(now) {
    if (!running) return;
    raf = requestAnimationFrame(animate);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const t = (now - t0) / 1000;
    applyCamera(t);

    if (!reduceMotion) {
      dust.rotation.y += dt * 0.012;
      POLAR.rotation.y -= dt * 0.008;
    }

    for (const node of nodes) {
      const bob = reduceMotion ? 0 : Math.sin(t * 0.85 + node.phase) * 0.055;
      node.root.position.set(
        node.base.x + (reduceMotion ? 0 : Math.sin(t * 0.33 + node.phase) * 0.02),
        node.base.y + bob,
        node.base.z
      );
      const busy = node.status === 'busy' && !reduceMotion;
      const pulse = busy ? 1 + Math.sin(now / 210) * 0.08 : 1;
      const hoverScale = node.id === hoveredId ? 1.35 : 1;
      node.core.scale.setScalar(pulse * hoverScale);
      if (node.cage) node.cage.scale.setScalar(hoverScale * (busy ? 1 + Math.sin(now / 260) * 0.05 : 1));
      node.ring.quaternion.copy(camera.quaternion);
      node.ring.scale.setScalar((busy ? 1 + Math.sin(now / 300) * 0.07 : 1) * hoverScale);
      node.halo.scale.setScalar(node.haloBase * (busy ? 1 + Math.sin(now / 260) * 0.12 : 1) * (node.id === hoveredId ? 1.18 : 1));
      const dim = Boolean(hoveredId && node.id !== hoveredId && !connected.has(node.id));
      node.coreMat.opacity = dim ? 0.42 : 1;
      node.ringMat.opacity = dim ? 0.06 : node.status === 'busy' ? 0.95 : node.isBoss ? 0.3 : node.isUser ? 0.5 : 0.18;
      node.halo.material.opacity = dim ? 0.12 : node.status === 'busy' ? 0.9 : node.isBoss ? 0.55 : 0.38;
    }

    updateLines(dt);
    updateLabels();
    renderer.render(scene, camera);

    if (!dragging) {
      const id = pickFromPointer();
      setHover(id);
    }
  }

  function pickFromPointer() {
    if (pointer.x < -1 || pointer.y < -1) return null;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    return hits.length ? hits[0].object.userData.nodeId : null;
  }

  const t0 = performance.now();

  function resize() {
    layoutView();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width, height, false);
    applyCamera((performance.now() - t0) / 1000);
    updateLabels();
  }

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (dragging) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      orbit.yaw = dragStart.yaw - dx * 0.0055;
      orbit.pitch = Math.max(0.03, Math.min(1.05, dragStart.pitch + dy * 0.004));
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging = true;
    dragMoved = 0;
    dragStart = { x: event.clientX, y: event.clientY, yaw: orbit.yaw, pitch: orbit.pitch };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
      /* pointer already released */
    }
    if (dragMoved < 6) {
      const id = pick(event.clientX, event.clientY);
      if (id && typeof AgentNet.onPick === 'function') AgentNet.onPick(id);
    }
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    canvas.style.cursor = pickFromPointer() ? 'pointer' : 'grab';
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (event) => {
    dragging = false;
    canvas.style.cursor = 'grab';
    void event;
  });
  canvas.addEventListener('pointerleave', () => {
    if (dragging) return;
    pointer.x = -2;
    pointer.y = -2;
    setHover(null);
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      orbit.zoom = Math.max(0.68, Math.min(1.55, orbit.zoom + event.deltaY * 0.0011));
    },
    { passive: false }
  );

  canvas.addEventListener('dblclick', () => {
    orbit.yaw = 0;
    orbit.pitch = 0.26;
    orbit.zoom = 1;
  });

  const AgentNet = {
    setBots(bots, providers) {
      const sig = nodeSignature(bots || [], providers || {});
      if (sig !== sceneSig) {
        rebuildScene(bots || [], providers || {});
      } else {
        const byId = new Map((bots || []).map((b) => [b.id, b]));
        for (const node of nodes) {
          if (node.isUser) continue;
          const bot = byId.get(node.id);
          if (!bot) continue;
          node.status = bot.status || 'idle';
          node.label = bot.name || node.id;
          paintNode(node);
        }
      }
      updateLabels();
    },
    stats() {
      return { nodes: nodes.length, links: links.length };
    },
    resize,
    onPick: null
  };
  window.AgentNet = AgentNet;

  new ResizeObserver(() => resize()).observe(stage);
  window.addEventListener('resize', resize);

  function start() {
    if (running) return;
    running = true;
    lastFrame = performance.now();
    raf = requestAnimationFrame(animate);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  rebuildScene([], {});
  resize();
  start();
})();
