const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}
window.addEventListener('resize', resize);
resize();

window.WORLD_WIDTH = 4000;
window.WORLD_HEIGHT = 4000;

let camera = { x: 0, y: 0 };
let player = new RpgPlayer(window.WORLD_WIDTH / 2, window.WORLD_HEIGHT / 2);
let enemies = [];
let projectiles = [];
let gems = [];

let isPlaying = false; // Start false, wait for login
let animationId;
let enemySpawnTimer = 0;
let nickname = "Player";
let autoAim = true;

// --- Firebase Initialization ---
const firebaseConfig = {
    databaseURL: "https://stickmanio-default-rtdb.firebaseio.com"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

window.currentZone = 'village';
let otherPlayers = {};
let myPlayerRef = null;
let networkSyncTimer = 0;
let respawnTimer = 0; // >0 means dead

// --- Network Listeners ---
let networkGems = {};
let gemListener = null;
let attackListener = null;
let playerListener = null;
const appStartTime = Date.now();

// --- Portals ---
let portals = [
    { id: 'battlefield1', name: '초보자 사냥터 (테스트)', x: window.WORLD_WIDTH/2, y: window.WORLD_HEIGHT/2 - 300, radius: 80, targetZone: 'battlefield1', limit: 20, count: 0 }
];
let portalCountListener = null;

function setupNetworkListeners() {
    // Detach old
    if (gemListener) database.ref(currentZone + '/gems').off('value', gemListener);
    if (attackListener) database.ref(currentZone + '/attacks').off('child_added', attackListener);
    if (playerListener) database.ref(currentZone + '/players').off('value', playerListener);
    if (portalCountListener) database.ref('portals').off('value', portalCountListener);

    networkGems = {};
    otherPlayers = {};

    gemListener = database.ref(currentZone + '/gems').on('value', snap => {
        networkGems = snap.val() || {};
    });

    attackListener = database.ref(currentZone + '/attacks').on('child_added', snap => {
        const atk = snap.val();
        if (atk && atk.timestamp >= appStartTime && atk.shooter !== nickname) {
            // (Deprecated: Projectiles removed, using cooldownTimer for sword swings)
            // Can add hit effect here later if needed
        }
    });

    playerListener = database.ref(currentZone + '/players').on('value', snap => {
        otherPlayers = snap.val() || {};
    });

    // Only village tracks all portal counts (for simplicity)
    if (currentZone === 'village') {
        portalCountListener = database.ref('portals').on('value', snap => {
            const counts = snap.val() || {};
            portals.forEach(p => {
                if (counts[p.id]) p.count = counts[p.id].count || 0;
            });
        });
    }
}

// --- PvP Damage Callback ---
window.onHitOtherPlayer = (targetNickname, damage) => {
    if (currentZone === 'village') return; // Safe zone
    const targetRef = database.ref(currentZone + '/players/' + targetNickname + '/hp');
    targetRef.once('value').then(snap => {
        if (snap.exists() && typeof snap.val() === 'number') {
            let newHp = Math.max(0, snap.val() - damage);
            targetRef.set(newHp);
        }
    });
};

window.onLocalAttack = (x, y, angle, dmg) => {
    if (currentZone === 'village') return;
    database.ref(currentZone + '/attacks').push({
        shooter: nickname,
        x: x,
        y: y,
        angle: angle,
        damage: dmg,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
};


// ─── 닉네임 유효성 검사 함수 ───
function validateNickname(name) {
    if (name.length < 2) return '닉네임은 최소 2글자 이상이어야 합니다.';
    if (name.length > 12) return '닉네임은 12글자 이하여야 합니다.';
    if (!/^[a-zA-Z0-9가-힣_]+$/.test(name)) return '영문, 숫자, 한글, _만 사용 가능합니다.';
    return null;
}

// 이전 닉네임 불러오기
const savedNickname = localStorage.getItem('rpgSurvival_nickname');
if (savedNickname) {
    document.getElementById('login-nickname').value = savedNickname;
}

// Login Logic
document.getElementById('login-start-btn').addEventListener('click', () => {
    const nameInput = document.getElementById('login-nickname').value.trim();
    const errorEl = document.getElementById('login-error');

    // 유효성 검사
    const validErr = validateNickname(nameInput);
    if (validErr) {
        errorEl.textContent = validErr;
        return;
    }

    // Check duplicate from Firebase
    database.ref(currentZone + '/players/' + nameInput).once('value').then(snap => {
        if (snap.exists() && snap.val().active) {
            errorEl.textContent = '이미 사용 중이거나 접속 중인 닉네임입니다.';
            return;
        }

        // Success Login
        errorEl.textContent = '';
        nickname = nameInput;
        localStorage.setItem('rpgSurvival_nickname', nickname);

        // Setup My Firebase Player
        myPlayerRef = database.ref(currentZone + '/players/' + nickname);
        myPlayerRef.onDisconnect().update({ active: false });

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');

        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            document.getElementById('mobile-controls').classList.remove('hidden');
        }

        setupNetworkListeners();

        isPlaying = true;
        loop();
    }).catch(err => {
        errorEl.textContent = '데이터베이스 연결 오류가 발생했습니다.';
        console.error(err);
    });
});

// Enter 키로도 로그인 가능
document.getElementById('login-nickname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-start-btn').click();
});

// Settings Logic
document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.remove('hidden');
});
document.getElementById('close-settings-btn').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
});
document.getElementById('auto-aim-toggle').addEventListener('change', (e) => {
    autoAim = e.target.checked;
    if (autoAim) {
        document.getElementById('joystick-right').classList.add('hidden');
    } else {
        document.getElementById('joystick-right').classList.remove('hidden');
    }
});

// Mobile Joysticks Logic
function setupJoystick(zoneId, callback) {
    const zone = document.getElementById(zoneId);
    const base = zone.querySelector('.joystick-base');
    const stick = zone.querySelector('.joystick-stick');
    
    let activeTouchId = null;
    let baseX = 0, baseY = 0;
    const maxDist = 35; // px

    zone.addEventListener('touchstart', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (activeTouchId === null) {
                const touch = e.changedTouches[i];
                activeTouchId = touch.identifier;
                
                base.style.display = 'block';
                base.style.left = touch.clientX + 'px';
                base.style.top = touch.clientY + 'px';
                base.style.bottom = 'auto'; // override css bottom
                base.style.transform = 'translate(-50%, -50%)';
                
                baseX = touch.clientX;
                baseY = touch.clientY;
                stick.style.transform = `translate(-50%, -50%)`;
                callback(0, 0);
            }
        }
    }, {passive: false});

    zone.addEventListener('touchmove', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                const touch = e.changedTouches[i];
                const dx = touch.clientX - baseX;
                const dy = touch.clientY - baseY;
                const dist = Math.hypot(dx, dy);
                
                let nx = dx, ny = dy;
                if (dist > maxDist) {
                    nx = (dx / dist) * maxDist;
                    ny = (dy / dist) * maxDist;
                }
                
                stick.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
                
                // Return normalized -1 to 1
                callback(nx / maxDist, ny / maxDist);
            }
        }
    }, {passive: false});

    const handleEnd = e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                activeTouchId = null;
                base.style.display = 'none';
                stick.style.transform = `translate(-50%, -50%)`;
                callback(0, 0);
            }
        }
    };
    zone.addEventListener('touchend', handleEnd, {passive: false});
    zone.addEventListener('touchcancel', handleEnd, {passive: false});
}

setupJoystick('joystick-left', (nx, ny) => {
    player.joyMove.x = nx;
    player.joyMove.y = ny;
});

setupJoystick('joystick-right', (nx, ny) => {
    player.joyAim.x = nx;
    player.joyAim.y = ny;
});

// Input handling
window.addEventListener('keydown', e => player.keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => player.keys[e.key.toLowerCase()] = false);

window.addEventListener('mousedown', e => {
    if (e.button === 0) player.isAttacking = true;
});
window.addEventListener('mouseup', e => {
    if (e.button === 0) player.isAttacking = false;
});
window.addEventListener('mousemove', e => {
    player.mouseX = e.clientX;
    player.mouseY = e.clientY;
});

function drawGrid(ctx) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 2;
    const gridSize = 100;

    // Draw only visible grid lines for performance
    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;
    const endX = startX + width + gridSize * 2;
    const endY = startY + height + gridSize * 2;

    ctx.beginPath();
    for (let x = startX; x <= Math.min(window.WORLD_WIDTH, endX); x += gridSize) {
        ctx.moveTo(x, Math.max(0, startY));
        ctx.lineTo(x, Math.min(window.WORLD_HEIGHT, endY));
    }
    for (let y = startY; y <= Math.min(window.WORLD_HEIGHT, endY); y += gridSize) {
        ctx.moveTo(Math.max(0, startX), y);
        ctx.lineTo(Math.min(window.WORLD_WIDTH, endX), y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, window.WORLD_WIDTH, window.WORLD_HEIGHT);
}

function drawMinimap(ctx) {
    const mmWidth = 200;
    const mmHeight = 200;
    const padding = 20;
    const mmX = width - mmWidth - padding;
    const mmY = padding;

    ctx.save();
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.fillRect(mmX, mmY, mmWidth, mmHeight);
    ctx.strokeRect(mmX, mmY, mmWidth, mmHeight);

    // Scale factors
    const scaleX = mmWidth / window.WORLD_WIDTH;
    const scaleY = mmHeight / window.WORLD_HEIGHT;

    // Camera Viewport Box
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(mmX + camera.x * scaleX, mmY + camera.y * scaleY, width * scaleX, height * scaleY);

    // Enemies
    ctx.fillStyle = '#ef4444';
    for (let e of enemies) {
        ctx.fillRect(mmX + e.x * scaleX - 1, mmY + e.y * scaleY - 1, 2, 2);
    }

    // Other Players
    ctx.fillStyle = '#f59e0b'; // Orange/Yellow for other players
    for (let key in otherPlayers) {
        if (key === nickname) continue;
        let op = otherPlayers[key];
        if (op.isAlive) {
            ctx.fillRect(mmX + op.x * scaleX - 2, mmY + op.y * scaleY - 2, 4, 4);
        }
    }

    // Player
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(mmX + player.x * scaleX - 2, mmY + player.y * scaleY - 2, 4, 4);

    ctx.restore();
}

function updateHUD() {
    document.getElementById('player-level').innerText = player.level;
    document.getElementById('player-kills').innerText = player.kills;
    
    const hpPerc = Math.max(0, player.hp / player.maxHp) * 100;
    document.getElementById('hp-bar').style.width = hpPerc + '%';
    document.getElementById('hp-text').innerText = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    
    const expPerc = (player.exp / player.maxExp) * 100;
    document.getElementById('exp-bar').style.width = expPerc + '%';
    document.getElementById('exp-text').innerText = `${player.exp} / ${player.maxExp}`;
    
    document.getElementById('stat-dmg').innerText = player.damage;
    document.getElementById('stat-spd').innerText = player.speed.toFixed(1);
    const atkSpd = (60 / player.attackCooldown).toFixed(1);
    document.getElementById('stat-atkspd').innerText = atkSpd;
}

function spawnEnemy() {
    const angle = Math.random() * Math.PI * 2;
    const dist = 600 + Math.random() * 200; // Spawn outside screen
    let ex = player.x + Math.cos(angle) * dist;
    let ey = player.y + Math.sin(angle) * dist;
    
    ex = Math.max(0, Math.min(window.WORLD_WIDTH, ex));
    ey = Math.max(0, Math.min(window.WORLD_HEIGHT, ey));

    enemies.push(new RpgEnemy(ex, ey, player.level));
}

function handleDeath() {
    if (respawnTimer > 0) return;
    
    // Drop 20% Exp
    const dropExp = Math.floor(player.exp * 0.2);
    if (dropExp > 0) {
        database.ref('gems').push({
            x: player.x,
            y: player.y,
            amount: dropExp,
            active: true
        });
        player.exp -= dropExp;
    }

    document.getElementById('hud').classList.add('hidden');
    const ds = document.getElementById('death-screen');
    ds.classList.remove('hidden');
    ds.innerHTML = `
        <h1 class="text-red">YOU DIED</h1>
        <p>Respawning in <span id="respawn-countdown">5</span>...</p>
    `;

    if (myPlayerRef) myPlayerRef.update({ isAlive: false, hp: 0 });
    respawnTimer = 300; // 5 seconds at 60fps
}

// Remove restart-btn listener as we auto-respawn
document.getElementById('restart-btn').style.display = 'none';

function drawOtherPlayer(ctx, pData, camX, camY) {
    if (!pData.isAlive) return;

    ctx.save();
    ctx.translate(pData.x, pData.y);
    
    // Face mouse
    const worldMouseX = pData.mouseX + camX;
    let facingRight = worldMouseX > pData.x;
    if (!facingRight) ctx.scale(-1, 1);

    const color = '#ef4444'; // Red for other players
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const radius = 16;
    const s = radius / 12;

    // Head
    ctx.beginPath();
    ctx.arc(0, -6 * s, 5 * s, 0, Math.PI * 2);
    ctx.stroke();

    // Body
    ctx.beginPath();
    ctx.moveTo(0, -1 * s);
    ctx.lineTo(0, 8 * s);
    ctx.stroke();

    // Legs
    const walkCycle = pData.walkCycle || 0;
    const legOffset = Math.sin(walkCycle) * 6 * s;
    ctx.beginPath();
    ctx.moveTo(0, 8 * s);
    ctx.lineTo(-6 * s, 16 * s + legOffset);
    ctx.moveTo(0, 8 * s);
    ctx.lineTo(6 * s, 16 * s - legOffset);
    ctx.stroke();

    // Arms
    ctx.beginPath();
    ctx.moveTo(0, 2 * s);
    ctx.lineTo(6 * s, 0); // right arm
    ctx.moveTo(0, 2 * s);
    ctx.lineTo(-4 * s, 4 * s); // left arm idle
    ctx.stroke();

    // Sword
    ctx.save();
    ctx.translate(6 * s, 0); // attach to right hand
    
    let swingAngle = -Math.PI / 4; // Idle angle
    if (pData.cooldownTimer !== undefined && pData.attackCooldown) {
        const swingTime = pData.attackCooldown * 0.4;
        if (pData.cooldownTimer > pData.attackCooldown - swingTime) {
            const progress = 1 - (pData.attackCooldown - pData.cooldownTimer) / swingTime;
            swingAngle = -Math.PI/4 + (Math.PI * 0.75) * (1 - progress);
        }
    }

    ctx.rotate(swingAngle - Math.PI/2); 

    // Draw Blade
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(18 * s, 0);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#cbd5e1'; 
    ctx.stroke();
    
    // Draw Hilt (Crossguard)
    ctx.beginPath();
    ctx.moveTo(3 * s, -3 * s);
    ctx.lineTo(3 * s, 3 * s);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#b45309'; 
    ctx.stroke();
    
    ctx.restore();

    ctx.restore();

    // Name and HP Bar
    ctx.save();
    ctx.translate(pData.x, pData.y);
    // HP Bar
    ctx.fillStyle = 'black';
    ctx.fillRect(-15, -25, 30, 4);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-15, -25, 30 * (Math.max(0, pData.hp) / pData.maxHp), 4);
    
    // Name
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(`Lv.${pData.level} ${pData.nickname || 'Enemy'}`, 0, -32);
    ctx.restore();
    ctx.restore();
}

function teleportToZone(zoneId, portalId) {
    if (player.isTeleporting) return;
    player.isTeleporting = true;

    // Increment portal count if entering from village
    if (currentZone === 'village' && portalId) {
        database.ref('portals/' + portalId + '/count').transaction(c => (c || 0) + 1);
    } else if (currentZone !== 'village') {
        // Leaving battlefield
        database.ref('portals/' + currentZone + '/count').transaction(c => Math.max(0, (c || 0) - 1));
    }

    if (myPlayerRef) {
        myPlayerRef.onDisconnect().cancel();
        myPlayerRef.update({ active: false });
    }

    currentZone = zoneId;
    
    // Set new player ref
    myPlayerRef = database.ref(currentZone + '/players/' + nickname);
    myPlayerRef.onDisconnect().update({ active: false });

    // Spawn point
    player.x = window.WORLD_WIDTH / 2 + (Math.random() - 0.5) * 400;
    player.y = window.WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 400;

    setupNetworkListeners();

    setTimeout(() => {
        player.isTeleporting = false;
    }, 2000); // 2 second teleport cooldown
}

function drawPortals(ctx) {
    // Village Portals
    if (currentZone === 'village') {
        portals.forEach(p => {
            ctx.save();
            ctx.translate(p.x, p.y);
            
            // Portal Effect
            ctx.beginPath();
            ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(139, 92, 246, 0.3)'; // Purple transparent
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#8b5cf6';
            ctx.stroke();

            // Inner Swirl
            ctx.rotate(Date.now() / 1000);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(p.radius, 0);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.stroke();
            
            ctx.restore();

            // Text
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 16px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(p.name, 0, -p.radius - 20);
            ctx.fillStyle = p.count >= p.limit ? '#ef4444' : '#10b981'; // Red if full, green if open
            ctx.fillText(`${p.count} / ${p.limit}`, 0, -p.radius - 5);
            ctx.restore();
        });
    } else {
        // Return Portal in Battlefields
        const rx = window.WORLD_WIDTH / 2;
        const ry = window.WORLD_HEIGHT / 2;
        const rRadius = 80;
        
        ctx.save();
        ctx.translate(rx, ry);
        
        ctx.beginPath();
        ctx.arc(0, 0, rRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.3)'; // Green transparent
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#10b981';
        ctx.stroke();

        // Inner Swirl
        ctx.rotate(-Date.now() / 1000);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(rRadius, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.stroke();
        
        ctx.restore();

        // Text
        ctx.save();
        ctx.translate(rx, ry);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Inter';
        ctx.textAlign = 'center';
        ctx.fillText("마을로 귀환", 0, -rRadius - 10);
        ctx.restore();
    }
}

document.getElementById('restart-btn').addEventListener('click', () => {
    player = new RpgPlayer(window.WORLD_WIDTH / 2, window.WORLD_HEIGHT / 2);
    enemies = [];
    projectiles = [];
    gems = [];
    isPlaying = true;
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('death-screen').classList.add('hidden');
    loop();
});

function loop() {
    if (!isPlaying) return;

    // Camera follow player (center screen)
    camera.x = player.x - width / 2;
    camera.y = player.y - height / 2;
    
    // Clamp camera
    camera.x = Math.max(0, Math.min(window.WORLD_WIDTH - width, camera.x));
    camera.y = Math.max(0, Math.min(window.WORLD_HEIGHT - height, camera.y));

    // Update
    player.update(projectiles, camera.x, camera.y, enemies, autoAim);
    
    if (!player.isAlive) {
        if (respawnTimer === 0) {
            handleDeath();
        } else {
            respawnTimer--;
            if (respawnTimer % 60 === 0) {
                const el = document.getElementById('respawn-countdown');
                if (el) el.innerText = Math.ceil(respawnTimer / 60);
            }
            if (respawnTimer <= 0) {
                // Respawn!
                player.hp = player.maxHp;
                player.isAlive = true;
                player.x = window.WORLD_WIDTH / 2 + (Math.random() - 0.5) * 500;
                player.y = window.WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 500;
                document.getElementById('death-screen').classList.add('hidden');
                document.getElementById('hud').classList.remove('hidden');
            }
        }
    } else {
        // Sync my state
        networkSyncTimer++;
        if (networkSyncTimer % 3 === 0 && myPlayerRef) {
            myPlayerRef.update({
                nickname: nickname,
                x: Math.round(player.x),
                y: Math.round(player.y),
                hp: player.hp,
                maxHp: player.maxHp,
                level: player.level,
                kills: player.kills,
                mouseX: player.mouseX,
                mouseY: player.mouseY,
                isAlive: player.isAlive,
                walkCycle: player.walkCycle,
                cooldownTimer: player.cooldownTimer,
                attackCooldown: player.attackCooldown,
                active: true
            });
            
            // Check if my Firebase HP was modified by others
            myPlayerRef.child('hp').once('value').then(snap => {
                if (snap.exists() && typeof snap.val() === 'number') {
                    if (snap.val() < player.hp) {
                        player.hp = snap.val();
                        if (player.hp <= 0 && player.isAlive) {
                            player.isAlive = false;
                        }
                    }
                }
            });
        }
    }

    const isVillage = currentZone === 'village';

    // Portal Logic
    if (isVillage) {
        portals.forEach(p => {
            const dist = Math.hypot(player.x - p.x, player.y - p.y);
            if (dist < player.radius + p.radius) {
                if (p.count < p.limit && !player.isTeleporting) {
                    teleportToZone(p.targetZone, p.id);
                }
            }
        });
        enemies = []; // No enemies in village
    } else {
        // Return Portal Logic in Battlefield
        const rx = window.WORLD_WIDTH / 2;
        const ry = window.WORLD_HEIGHT / 2;
        const dist = Math.hypot(player.x - rx, player.y - ry);
        if (dist < player.radius + 80 && !player.isTeleporting) {
            teleportToZone('village', null);
        }

        enemySpawnTimer++;
        // Spawn rate increases with level
        const spawnRate = Math.max(20, 100 - player.level * 5);
        if (enemySpawnTimer > spawnRate && player.isAlive) {
            spawnEnemy();
            enemySpawnTimer = 0;
        }
    }

    projectiles.forEach(p => p.update(enemies, otherPlayers, nickname));
    projectiles = projectiles.filter(p => p.active);

    enemies.forEach(e => {
        if (player.isAlive) e.update(player);
        if (!e.isAlive && e.hp <= 0 && e.expValue > 0) {
            gems.push(new ExpGem(e.x, e.y, e.expValue));
            player.kills++;
            e.expValue = 0;
        }
    });
    enemies = enemies.filter(e => e.isAlive);

    if (player.isAlive) {
        gems.forEach(g => g.update(player));
    }
    gems = gems.filter(g => g.active);

    // Network gems collision
    if (player.isAlive) {
        for (let key in networkGems) {
            let ng = networkGems[key];
            if (ng && ng.active) {
                const dist = Math.hypot(player.x - ng.x, player.y - ng.y);
                if (dist < player.radius + 6) { // gem radius 6
                    player.gainExp(ng.amount);
                    database.ref('gems/' + key).remove();
                }
            }
        }
    }

    if (player.isAlive) updateHUD();

    // Draw
    ctx.clearRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    
    drawGrid(ctx);
    
    // Draw Network Gems
    for (let key in networkGems) {
        let ng = networkGems[key];
        if (ng && ng.active) {
            ctx.save();
            ctx.translate(ng.x, ng.y + Math.sin(Date.now()/200) * 3);
            ctx.fillStyle = '#f59e0b'; // Gold for network gems
            ctx.shadowColor = '#d97706';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(6, 0);
            ctx.lineTo(0, 6);
            ctx.lineTo(-6, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    // Draw Portals
    drawPortals(ctx);

    gems.forEach(g => g.draw(ctx));
    projectiles.forEach(p => p.draw(ctx));
    enemies.forEach(e => e.draw(ctx));
    
    // Draw Other Players
    for (let key in otherPlayers) {
        if (key === nickname) continue;
        drawOtherPlayer(ctx, otherPlayers[key], camera.x, camera.y);
    }

    if (player.isAlive) {
        player.draw(ctx, camera.x, camera.y);
        // Draw Nickname
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(nickname, player.x, player.y - player.radius - 15);
    }
    
    // (Removed duplicate Nickname draw)
    
    ctx.restore();

    // Draw minimap on top of everything (UI coordinates)
    drawMinimap(ctx);

    animationId = requestAnimationFrame(loop);
}

// Start immediately with empty canvas, game loop won't run logic until isPlaying is true
ctx.clearRect(0, 0, width, height);
drawGrid(ctx);
