// main.js - 修正出生点位置，避免陷入平台
(function () {
    // ==================== 全局配置 ====================
    const CONFIG = {
        environment: {
            skyColor: '#1a1a2e',
            fogColor: '#3a2a1a',
            fogDensity: 0.0012,
            ambientColor: '#4a3a2a',
            ambientIntensity: 0.5,
            moonLightColor: '#c8d8ff',
            moonLightIntensity: 1.8,
            platformColor: '#000000',
            goalPlatformColor: '#000000',
            wallColor: '#3a3a3a',
            cameraGoalHeight: 6,
        },
        menu: {
            loadBatch: 20,
            loadMore: 10,
        },
        challenge: {
            timeLimit: 90,
        },
        music: {
            path: 'img/music.mp3',
            volume: 0.3,
        },
        mouse: {
            sensitivity: 0.5,
        },
        levelLoad: {
            concurrent: 5,
            maxFails: 3,
        },
        checkpoint: {
            blinkDuration: 0.6,
            blinkCycles: 3,
            stepsPerCycle: 12,
        },
        spawnOffset: 0.2,   // 出生点/保存点 高于平台顶部的偏移量
    };

    // ==================== DOM 元素 ====================
    const $ = (id) => document.getElementById(id);
    const logoOverlay = $('logo-overlay');
    const mainMenu = $('main-menu');
    const gameContainer = $('game-container');
    const transitionOverlay = $('transition-overlay');
    const levelTitleEl = $('level-title');
    const tooltipEl = $('tooltip');
    const skipBtn = $('skip-btn');
    const divider = $('divider');
    const challengeTimerEl = $('challenge-timer');
    const challengeFailEl = $('challenge-fail');
    const menuContinueBtn = $('menu-continue-btn');
    const canvas = $('game-canvas');

    // ==================== 全局状态 ====================
    let game = null;
    let currentMode = 'trial';
    let backgroundMusic = null;
    let musicResumeHandler = null;

    // ==================== 预加载纹理（月球，带超时） ====================
    let cachedMoonTexture = null;

    function preloadMoonTexture() {
        return new Promise((resolve) => {
            const loader = new THREE.TextureLoader();
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 2; canvas.height = 2;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,2,2);
                    resolve(new THREE.CanvasTexture(canvas));
                    resolved = true;
                }
            }, 3000);
            loader.load('img/moon.png', tex => {
                if (!resolved) {
                    clearTimeout(timeout);
                    tex.colorSpace = THREE.SRGBColorSpace;
                    resolve(tex);
                    resolved = true;
                }
            }, undefined, () => {
                if (!resolved) {
                    clearTimeout(timeout);
                    const canvas = document.createElement('canvas');
                    canvas.width = 2; canvas.height = 2;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,2,2);
                    resolve(new THREE.CanvasTexture(canvas));
                    resolved = true;
                }
            });
        });
    }

    // ==================== 背景音乐 ====================
    function prepareBackgroundMusic() {
        try {
            if (backgroundMusic) return;
            backgroundMusic = new Audio();
            backgroundMusic.loop = true;
            backgroundMusic.volume = CONFIG.music.volume;
            backgroundMusic.src = CONFIG.music.path;
            backgroundMusic.addEventListener('error', () => {
                console.warn('背景音乐加载失败');
                backgroundMusic = null;
            }, { once: true });
        } catch (e) {
            console.warn('背景音乐初始化失败:', e.message);
            backgroundMusic = null;
        }
    }

    function tryPlayMusic() {
        if (!backgroundMusic) return;
        const playPromise = backgroundMusic.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                const resume = () => {
                    if (backgroundMusic && backgroundMusic.paused && backgroundMusic.src) {
                        backgroundMusic.play().catch(e => console.warn('恢复播放失败:', e));
                    }
                    document.removeEventListener('click', resume);
                    document.removeEventListener('touchstart', resume);
                    musicResumeHandler = null;
                };
                if (musicResumeHandler) {
                    document.removeEventListener('click', musicResumeHandler);
                    document.removeEventListener('touchstart', musicResumeHandler);
                }
                musicResumeHandler = resume;
                document.addEventListener('click', resume);
                document.addEventListener('touchstart', resume);
            });
        }
    }

    // ==================== 工具函数 ====================
    function animateDivider() {
        if (!divider) return;
        divider.style.transition = 'none';
        divider.style.opacity = '1';
        divider.style.height = '0';
        requestAnimationFrame(() => {
            divider.style.transition = 'height 0.1s linear';
            divider.style.height = '100%';
        });
        setTimeout(() => {
            divider.style.transition = 'opacity 0.15s';
            let count = 0;
            const blink = setInterval(() => {
                divider.style.opacity = (count % 2 === 0) ? '0' : '1';
                count++;
                if (count === 6) {
                    clearInterval(blink);
                    divider.style.opacity = '0';
                    divider.style.height = '0';
                    divider.style.transition = 'none';
                }
            }, 166);
        }, 100);
    }

    let titleTimer = null;
    function showLevelTitle(title) {
        if (!levelTitleEl) return;
        if (titleTimer) clearTimeout(titleTimer);
        levelTitleEl.textContent = title || '未知关卡';
        levelTitleEl.style.transition = 'opacity 0.3s';
        levelTitleEl.style.opacity = '1';
        titleTimer = setTimeout(() => { levelTitleEl.style.opacity = '0'; }, 900);
    }

    function disposeObject3D(obj) {
        if (!obj) return;
        obj.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    function safeArrayValue(arr, index, defaultValue = 0) {
        if (!Array.isArray(arr) || arr.length < 2 || typeof arr[index] !== 'number') {
            return defaultValue;
        }
        return arr[index];
    }

    function safeRangeMid(range, defaultValue = 0) {
        if (!Array.isArray(range) || range.length < 2) return defaultValue;
        const v0 = safeArrayValue(range, 0, defaultValue);
        const v1 = safeArrayValue(range, 1, defaultValue);
        if (isNaN(v0) || isNaN(v1)) return defaultValue;
        return (v0 + v1) / 2;
    }

    // ==================== 线性插值颜色 ====================
    function lerpColor(color1, color2, t) {
        const r = color1.r + (color2.r - color1.r) * t;
        const g = color1.g + (color2.g - color1.g) * t;
        const b = color1.b + (color2.b - color1.b) * t;
        return new THREE.Color(r, g, b);
    }

    // ==================== 玩家类 ====================
    class Player {
        constructor(camera, scene, startPos) {
            this.camera = camera;
            this.scene = scene;
            this.startPosition = startPos.clone();
            this.checkpoint = startPos.clone();
            this.position = startPos.clone();
            this.velocity = new THREE.Vector3();
            this.yaw = 0;
            this.pitch = 0;
            this.isGrounded = false;
            this.gravity = 22;
            this.jumpForce = 14;
            this.speed = 9;
            this.height = 1.6;
            this.radius = 0.4;
            this.lastGroundMesh = null;
            this.lastGroundPos = new THREE.Vector3();
            this.currentGroundMesh = null;
            this.camera.position.copy(this.position);
            this.camera.rotation.order = 'YXZ';
            this.lastAirborneTime = 0;
            this.isClimbing = false;
            this.climbData = null;
            this.postClimbTimer = 0;
        }

        respawn() {
            this.position.copy(this.checkpoint);
            this.velocity.set(0, 0, 0);
            this.isGrounded = false;
            this.lastGroundMesh = null;
            this.currentGroundMesh = null;
            this.camera.position.copy(this.position);
        }

        setCheckpoint(pos) {
            this.checkpoint.copy(pos);
        }

        update(dt, input, worldMeshes, wallMeshes) {
            const now = performance.now() / 1000;
            if (!this.isGrounded) this.lastAirborneTime = now;

            if (this.isClimbing) { this.updateClimbing(dt, now); return; }
            if (this.postClimbTimer > 0) {
                this.postClimbTimer -= dt;
                const shakeAmt = Math.max(0, this.postClimbTimer) * 0.05;
                this.camera.rotation.y = this.yaw + Math.sin(now * 30) * shakeAmt;
                this.camera.rotation.x = this.pitch + Math.cos(now * 25) * shakeAmt * 0.5;
                if (this.postClimbTimer <= 0) {
                    this.camera.rotation.y = this.yaw;
                    this.camera.rotation.x = this.pitch;
                }
                return;
            }

            const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
            const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
            const moveDir = new THREE.Vector3(0,0,0);
            moveDir.add(forward.clone().multiplyScalar(input.move.y * this.speed));
            moveDir.add(right.clone().multiplyScalar(input.move.x * this.speed));
            if (moveDir.length() > this.speed) moveDir.normalize().multiplyScalar(this.speed);

            if (this.isGrounded && this.lastGroundMesh) {
                const currentGroundPos = new THREE.Vector3();
                this.lastGroundMesh.getWorldPosition(currentGroundPos);
                const delta = currentGroundPos.clone().sub(this.lastGroundPos);
                if (delta.length() > 0.001) {
                    this.position.add(delta);
                }
                this.lastGroundPos.copy(currentGroundPos);
            }

            if (input.jump && this.isGrounded) {
                this.velocity.y = this.jumpForce;
                this.isGrounded = false;
                this.lastGroundMesh = null;
                this.currentGroundMesh = null;
            }
            if (!this.isGrounded) this.velocity.y -= this.gravity * dt;

            this.position.x += moveDir.x * dt;
            this.position.z += moveDir.z * dt;
            this.position.y += this.velocity.y * dt;

            this.isGrounded = false;
            this.currentGroundMesh = null;
            const rayOrigin = this.position.clone(); rayOrigin.y += 0.1;
            if (worldMeshes.length > 0) {
                const raycaster = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, this.height + 0.3);
                const intersects = raycaster.intersectObjects(worldMeshes, false);
                if (intersects.length > 0 && intersects[0].point && typeof intersects[0].point.y === 'number') {
                    const groundY = intersects[0].point.y;
                    if (this.position.y - this.height <= groundY + 0.05) {
                        this.position.y = groundY + this.height;
                        this.velocity.y = 0;
                        this.isGrounded = true;
                        const groundMesh = intersects[0].object;
                        if (groundMesh !== this.lastGroundMesh) {
                            this.lastGroundMesh = groundMesh;
                            groundMesh.getWorldPosition(this.lastGroundPos);
                        }
                        this.currentGroundMesh = groundMesh;
                    }
                }
            }

            if (this.position.y < -5) {
                this.respawn();
            }

            // 墙壁碰撞与攀爬（完整保留）
            const playerBox = {
                minX: this.position.x - this.radius,
                maxX: this.position.x + this.radius,
                minY: this.position.y - this.height,
                maxY: this.position.y,
                minZ: this.position.z - this.radius,
                maxZ: this.position.z + this.radius,
            };
            let bestClimbCandidate = null;
            let bestClimbDot = -1;

            for (const mesh of wallMeshes) {
                const box = new THREE.Box3().setFromObject(mesh);
                const obs = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
                const overlapX = Math.min(playerBox.maxX, obs.maxX) - Math.max(playerBox.minX, obs.minX);
                const overlapY = Math.min(playerBox.maxY, obs.maxY) - Math.max(playerBox.minY, obs.minY);
                const overlapZ = Math.min(playerBox.maxZ, obs.maxZ) - Math.max(playerBox.minZ, obs.minZ);
                if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
                    let normal = new THREE.Vector3();
                    if (overlapX <= overlapY && overlapX <= overlapZ) normal.x = this.position.x > (obs.minX + obs.maxX) / 2 ? 1 : -1;
                    else if (overlapY <= overlapX && overlapY <= overlapZ) normal.y = this.position.y > (obs.minY + obs.maxY) / 2 ? 1 : -1;
                    else normal.z = this.position.z > (obs.minZ + obs.maxZ) / 2 ? 1 : -1;

                    const wallNormal = new THREE.Vector3(normal.x, 0, normal.z).normalize();
                    const camForward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
                    const dot = camForward.dot(wallNormal.clone().multiplyScalar(-1));
                    if (wallNormal.length() > 0.1 && dot > Math.cos(15 * Math.PI / 180)) {
                        if (now - this.lastAirborneTime < 2.0) {
                            if (dot > bestClimbDot) { bestClimbDot = dot; bestClimbCandidate = { mesh, normal: wallNormal.clone(), box }; }
                        }
                    }
                }
            }
            if (bestClimbCandidate) { this.startClimbing(bestClimbCandidate); return; }

            for (const mesh of wallMeshes) {
                const box = new THREE.Box3().setFromObject(mesh);
                const obs = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z };
                const overlapX = Math.min(playerBox.maxX, obs.maxX) - Math.max(playerBox.minX, obs.minX);
                const overlapY = Math.min(playerBox.maxY, obs.maxY) - Math.max(playerBox.minY, obs.minY);
                const overlapZ = Math.min(playerBox.maxZ, obs.maxZ) - Math.max(playerBox.minZ, obs.minZ);
                if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
                    let pushDir = new THREE.Vector3();
                    if (overlapX <= overlapY && overlapX <= overlapZ) pushDir.x = this.position.x > (obs.minX + obs.maxX) / 2 ? 1 : -1;
                    else if (overlapY <= overlapX && overlapY <= overlapZ) pushDir.y = this.position.y > (obs.minY + obs.maxY) / 2 ? 1 : -1;
                    else pushDir.z = this.position.z > (obs.minZ + obs.maxZ) / 2 ? 1 : -1;

                    if (pushDir.x !== 0) this.position.x += pushDir.x * overlapX;
                    else if (pushDir.y !== 0) this.position.y += pushDir.y * overlapY;
                    else if (pushDir.z !== 0) this.position.z += pushDir.z * overlapZ;

                    if (pushDir.x !== 0 && this.velocity.x * pushDir.x > 0) this.velocity.x = 0;
                    if (pushDir.y !== 0 && this.velocity.y * pushDir.y > 0) this.velocity.y = 0;
                    if (pushDir.z !== 0 && this.velocity.z * pushDir.z > 0) this.velocity.z = 0;
                }
            }

            this.camera.position.copy(this.position);
            this.camera.rotation.y = this.yaw;
            this.camera.rotation.x = this.pitch;
        }

        rotate(dx, dy) {
            if (this.isClimbing || this.postClimbTimer > 0) return;
            this.yaw -= dx * 0.005;
            this.pitch -= dy * 0.005;
            this.pitch = Math.max(-1.0, Math.min(0.5, this.pitch));
        }

        startClimbing(candidate) {
            const box = candidate.box; const normal = candidate.normal;
            const targetY = box.max.y + this.height;
            const climbSpeed = 5.0;
            const heightDiff = targetY - this.position.y;
            const duration = Math.max(0.2, heightDiff / climbSpeed);
            const wallOffset = 0.6;
            const targetXZ = new THREE.Vector2(
                (box.min.x + box.max.x) / 2 + normal.x * (box.max.x - box.min.x) / 2 + normal.x * wallOffset,
                (box.min.z + box.max.z) / 2 + normal.z * (box.max.z - box.min.z) / 2 + normal.z * wallOffset
            );
            this.climbData = {
                normal, startPos: this.position.clone(),
                targetPos: new THREE.Vector3(targetXZ.x, targetY, targetXZ.y),
                startTime: performance.now() / 1000, duration, startYaw: this.yaw
            };
            this.isClimbing = true; this.velocity.set(0, 0, 0); this.isGrounded = false;
        }
        updateClimbing(dt, now) {
            const data = this.climbData;
            const elapsed = now - data.startTime;
            const progress = Math.min(elapsed / data.duration, 1.0);
            this.position.lerpVectors(data.startPos, data.targetPos, progress);
            const swingFreq = 2.5, maxSwingAmp = 0.15;
            const amp = Math.sin(progress * Math.PI) * maxSwingAmp;
            const swingAngle = Math.sin(progress * Math.PI * 2 * swingFreq) * amp;
            const pitchSwing = Math.cos(progress * Math.PI * 2 * (swingFreq + 0.3)) * Math.sin(progress * Math.PI) * 0.05;
            this.camera.position.copy(this.position);
            this.camera.rotation.y = data.startYaw + swingAngle;
            this.camera.rotation.x = this.pitch + pitchSwing;
            if (progress >= 1.0) this.finishClimbing();
        }
        finishClimbing() {
            this.position.copy(this.climbData.targetPos);
            this.yaw = this.camera.rotation.y;
            this.pitch = this.camera.rotation.x;
            this.isClimbing = false; this.climbData = null;
            this.isGrounded = true;
            this.velocity.set(0, 0, 0);
            this.postClimbTimer = 0.3;
            this.camera.position.copy(this.position);
        }
    }

    // ==================== 游戏主类 ====================
    class Game {
        constructor(canvas) {
            this.canvas = canvas;
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.toneMapping = THREE.ReinhardToneMapping;
            this.renderer.toneMappingExposure = 1.8;

            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(CONFIG.environment.skyColor);
            this.scene.fog = new THREE.FogExp2(CONFIG.environment.fogColor, CONFIG.environment.fogDensity);

            this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
            this.clock = new THREE.Clock();

            this.ambient = new THREE.AmbientLight(CONFIG.environment.ambientColor, CONFIG.environment.ambientIntensity);
            this.scene.add(this.ambient);
            this.sunLight = new THREE.DirectionalLight(CONFIG.environment.moonLightColor, CONFIG.environment.moonLightIntensity);
            this.sunLight.castShadow = true;
            this.sunLight.shadow.mapSize.width = 1024; this.sunLight.shadow.mapSize.height = 1024;
            this.sunLight.shadow.camera.near = 0.5; this.sunLight.shadow.camera.far = 300;
            this.sunLight.shadow.camera.left = -80; this.sunLight.shadow.camera.right = 80;
            this.sunLight.shadow.camera.top = 80; this.sunLight.shadow.camera.bottom = -80;
            this.sunLight.shadow.bias = -0.0001;
            this.sunLight.target = new THREE.Object3D();
            this.scene.add(this.sunLight.target);
            this.scene.add(this.sunLight);

            this.moonRadius = 225;
            this.glowOffset = 30;
            const elevation = 35 * Math.PI / 180;
            const azimuth = Math.random() * Math.PI * 2;
            const x = Math.cos(elevation) * Math.cos(azimuth);
            const y = Math.sin(elevation);
            const z = Math.cos(elevation) * Math.sin(azimuth);
            this.moonDirection = new THREE.Vector3(x, y, z).normalize();

            this.glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.createGlowTexture(), blending: THREE.AdditiveBlending,
                depthTest: true, depthWrite: false, opacity: 0.8
            }));
            this.glowSprite.scale.set(140, 140, 1); this.glowSprite.renderOrder = 0;
            this.scene.add(this.glowSprite);
            this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: null, transparent: true, color: 0xffffff,
                depthTest: true, depthWrite: false
            }));
            this.moonSprite.scale.set(27.5, 27.5, 1); this.moonSprite.renderOrder = 1;
            this.scene.add(this.moonSprite);
            this.moonBrightLayer = new THREE.Sprite(new THREE.SpriteMaterial({
                map: null, transparent: true, blending: THREE.AdditiveBlending,
                opacity: 0.5, depthTest: true, depthWrite: false
            }));
            this.moonBrightLayer.scale.set(29, 29, 1); this.moonBrightLayer.renderOrder = 0;
            this.scene.add(this.moonBrightLayer);

            if (cachedMoonTexture) this.applyMoonTexture(cachedMoonTexture);

            const starsGeo = new THREE.BufferGeometry();
            const starsCount = 2000;
            const starsPositions = new Float32Array(starsCount * 3);
            for (let i = 0; i < starsCount * 3; i += 3) {
                starsPositions[i] = (Math.random() - 0.5) * 1000;
                starsPositions[i+1] = Math.random() * 300 + 10;
                starsPositions[i+2] = (Math.random() - 0.5) * 800 - 200;
            }
            starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPositions, 3));
            this.stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({
                color: '#ffeedd', size: 0.3, transparent: true,
                blending: THREE.AdditiveBlending, depthWrite: false
            }));
            this.scene.add(this.stars);

            this.worldMeshes = []; this.wallMeshes = []; this.dynamicObjects = [];
            this.checkpointMeshes = [];
            this.lastCheckpointMesh = null;
            this.blinkingCheckpoints = new Map();
            this.player = null;
            this.input = { move: { x: 0, y: 0 }, jump: false };
            this.moveTouchId = null; this.viewTouchId = null; this.moveStart = null; this.viewStart = null;
            this.keyJumpConsumed = false;
            this.lastRotation = { x: 0, y: 0 };
            this.pendingJump = false;
            this.touchStartTime = 0; this.touchStartPos = { x: 0, y: 0 };
            this.goalPlatformMesh = null;
            this.goalStandTimer = 0;
            this.goalRequiredTime = 0.8;
            this.goalReached = false;
            this.currentLevel = 1;
            this.transitioning = true;
            this.shownTooltips = new Set();
            this.currentLevelName = '';
            this.goalPosition = null;
            this.cameraFlight = null;
            this.challengeTimeLeft = CONFIG.challenge.timeLimit;
            this.challengeTimerRunning = false;
            this.lastTimerUpdate = 0;
            this.mode = 'trial';
            this._flightResolve = null;
            this.paused = false;

            this._pointerLockEnabled = false;
            this._onPointerLockChange = this._onPointerLockChange.bind(this);
            this._onMouseMove = this._onMouseMove.bind(this);
            this._onPointerDown = this._onPointerDown.bind(this);

            this.setupSkipButton();
            this.setupInput();
            this.animate();
        }

        applyMoonTexture(texture) {
            if (this.moonSprite) {
                this.moonSprite.material.map = texture;
                this.moonSprite.material.needsUpdate = true;
            }
            if (this.moonBrightLayer) {
                this.moonBrightLayer.material.map = texture;
                this.moonBrightLayer.material.needsUpdate = true;
            }
        }

        createGlowTexture() {
            const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
            gradient.addColorStop(0, 'rgba(255, 240, 210, 1)');
            gradient.addColorStop(0.1, 'rgba(210, 230, 255, 0.95)');
            gradient.addColorStop(0.25, 'rgba(160, 190, 240, 0.7)');
            gradient.addColorStop(0.5, 'rgba(100, 140, 200, 0.4)');
            gradient.addColorStop(0.8, 'rgba(70, 100, 160, 0.15)');
            gradient.addColorStop(1, 'rgba(50, 70, 130, 0)');
            ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512);
            return new THREE.CanvasTexture(canvas);
        }

        updateSkyAndLighting(playerPos) {
            if (!this.moonDirection) return;
            const moonPos = this.moonDirection.clone().multiplyScalar(this.moonRadius);
            const glowPos = this.moonDirection.clone().multiplyScalar(this.moonRadius + this.glowOffset);
            this.sunLight.position.copy(moonPos);
            this.sunLight.target.position.set(0,0,0);
            if (this.moonSprite) this.moonSprite.position.copy(moonPos);
            if (this.moonBrightLayer) this.moonBrightLayer.position.copy(moonPos);
            if (this.glowSprite) this.glowSprite.position.copy(glowPos);
            if (this.stars) this.stars.position.copy(playerPos);
        }

        clearScene() {
            const keepSet = new Set([
                this.ambient, this.sunLight, this.sunLight.target,
                this.moonSprite, this.moonBrightLayer, this.glowSprite,
                this.stars
            ]);
            const toRemove = [];
            this.scene.children.forEach(c => {
                if (!keepSet.has(c)) toRemove.push(c);
            });
            toRemove.forEach(c => { disposeObject3D(c); this.scene.remove(c); });
            this.worldMeshes.length = 0;
            this.wallMeshes.length = 0;
            this.dynamicObjects.length = 0;
            this.checkpointMeshes = [];
            this.lastCheckpointMesh = null;
            this.blinkingCheckpoints.clear();
            this.goalPlatformMesh = null;
            this.goalStandTimer = 0;
            this.goalReached = false;
            this.shownTooltips.clear();
            this.goalPosition = null;
        }

        smoothBlinkCheckpoint(mesh) {
            if (!mesh || !mesh.material) return;
            if (this.blinkingCheckpoints.has(mesh)) return;
            
            const originalColor = mesh.material.color.clone();
            const whiteColor = new THREE.Color(0xffffff);
            const duration = CONFIG.checkpoint.blinkDuration;
            const cycles = CONFIG.checkpoint.blinkCycles;
            let startTime = performance.now();
            this.blinkingCheckpoints.set(mesh, true);
            
            const animateBlink = () => {
                const now = performance.now();
                const elapsed = now - startTime;
                if (elapsed >= duration) {
                    mesh.material.color.copy(originalColor);
                    this.blinkingCheckpoints.delete(mesh);
                    return;
                }
                const t = elapsed / duration;
                const phase = cycles * 2 * Math.PI * t;
                const intensity = (Math.sin(phase) + 1) / 2;
                const currentColor = lerpColor(originalColor, whiteColor, intensity);
                mesh.material.color.copy(currentColor);
                requestAnimationFrame(animateBlink);
            };
            requestAnimationFrame(animateBlink);
        }

        // 计算平台顶部 + 偏移量
        getSpawnPositionFromPlatform(mesh, offset = CONFIG.spawnOffset) {
            if (!mesh || !mesh.geometry) return null;
            const height = mesh.geometry.parameters.height;
            const pos = mesh.position.clone();
            pos.y += height / 2 + offset;
            return pos;
        }

        checkAndUpdateCheckpoint() {
            if (!this.player || !this.player.currentGroundMesh) return;
            const mesh = this.player.currentGroundMesh;
            if (mesh.userData.isCheckpoint) {
                // 获取平台顶面 + 偏移量的位置作为保存点
                const spawnPos = this.getSpawnPositionFromPlatform(mesh);
                if (spawnPos) {
                    this.player.setCheckpoint(spawnPos);
                } else {
                    this.player.setCheckpoint(mesh.position.clone());
                }
                if (this.lastCheckpointMesh !== mesh) {
                    this.smoothBlinkCheckpoint(mesh);
                    this.lastCheckpointMesh = mesh;
                }
            } else {
                if (this.lastCheckpointMesh === mesh) {
                    this.lastCheckpointMesh = null;
                }
            }
        }

        enablePointerLock() {
            if (this._pointerLockEnabled) return;
            this._pointerLockEnabled = true;
            document.addEventListener('pointerlockchange', this._onPointerLockChange);
            document.addEventListener('mousemove', this._onMouseMove);
            this.canvas.addEventListener('click', this._onPointerDown);
            this.canvas.requestPointerLock();
        }

        disablePointerLock() {
            if (!this._pointerLockEnabled) return;
            this._pointerLockEnabled = false;
            document.removeEventListener('pointerlockchange', this._onPointerLockChange);
            document.removeEventListener('mousemove', this._onMouseMove);
            this.canvas.removeEventListener('click', this._onPointerDown);
            if (document.pointerLockElement === this.canvas) {
                document.exitPointerLock();
            }
        }

        _onPointerLockChange() {}
        _onPointerDown() {
            if (!this._pointerLockEnabled) return;
            if (document.pointerLockElement !== this.canvas) {
                this.canvas.requestPointerLock();
            }
        }
        _onMouseMove(e) {
            if (!this._pointerLockEnabled) return;
            if (document.pointerLockElement !== this.canvas) return;
            if (this.transitioning || this.paused) return;
            if (!this.player) return;
            const sensitivity = CONFIG.mouse.sensitivity;
            this.player.rotate(e.movementX * sensitivity, e.movementY * sensitivity);
        }

        async startLevel(levelNum, mode) {
            tryPlayMusic();

            this.cameraFlight = null;
            if (this._flightResolve) { this._flightResolve(); this._flightResolve = null; }
            this.mode = mode || 'trial';
            this.currentLevel = levelNum;
            this.transitioning = true;
            this.paused = false;
            if (this.challengeTimerRunning) this.stopChallengeTimer();

            if (skipBtn) {
                skipBtn.style.display = this.mode === 'trial' ? 'flex' : 'none';
                if (this.mode === 'trial') skipBtn.style.pointerEvents = 'auto';
            }
            if (challengeTimerEl) {
                challengeTimerEl.style.display = this.mode === 'challenge' ? 'block' : 'none';
            }
            this.challengeTimeLeft = CONFIG.challenge.timeLimit;

            this.enablePointerLock();

            await this.loadLevel(levelNum);

            if (transitionOverlay) {
                transitionOverlay.style.transition = 'opacity 0.8s';
                transitionOverlay.style.opacity = '1';
                await new Promise(r => setTimeout(r, 600));
            }
            showLevelTitle(this.currentLevelName);
            await new Promise(r => setTimeout(r, 1200));
            if (transitionOverlay) transitionOverlay.style.opacity = '0';
            await new Promise(r => setTimeout(r, 500));

            const startPos = this.player ? this.player.startPosition.clone() : new THREE.Vector3(0,2,0);
            let goalPos = this.goalPosition ? this.goalPosition.clone() : startPos.clone().add(new THREE.Vector3(0,0,10));
            const goalLookAt = goalPos.clone();
            const toGoalPos = goalPos.clone().add(new THREE.Vector3(0, CONFIG.environment.cameraGoalHeight, 0));
            this.cameraFlight = {
                phase: 'toGoal', phaseStart: performance.now() / 1000,
                from: startPos.clone(), toGoalPos, goalLookAt,
                startPos: startPos.clone(), toGoalDuration: 1.0, toStartDuration: 2.0
            };
            await new Promise(resolve => { this._flightResolve = resolve; });
            animateDivider();
            await new Promise(r => setTimeout(r, 1300));

            this.transitioning = false;
            if (this.mode === 'challenge') this.startChallengeTimer();
        }

        async loadLevel(levelNum) {
            this.clearScene();
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const resp = await fetch(`map/level${levelNum}.json`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                if (!data || (!data.startPosition && !data.platforms?.some(p => p.type === 1))) throw new Error('无效出生点');
                this.buildLevel(data);
                let startPos = null;
                // 查找起点平台（type:1），计算其顶部 + 偏移量
                for (const mesh of this.worldMeshes) {
                    if (mesh.userData.isStart) {
                        startPos = this.getSpawnPositionFromPlatform(mesh);
                        break;
                    }
                }
                // 如果没有找到起点平台，回退到 data.startPosition（旧版兼容）
                if (!startPos && data.startPosition) {
                    startPos = new THREE.Vector3(data.startPosition.x, data.startPosition.y, data.startPosition.z);
                    // 如果旧数据给的也是平台中心，同样加上偏移？旧版通常给的就是平台顶部？为了安全，统一按平台中心 + 偏移不可行，因为没有平台几何体。
                    // 这里简单处理：假设旧数据给的是平台顶部 y 坐标，不加偏移。或者直接加 0.2 也可能导致悬浮。暂保持原样。
                }
                if (!startPos) startPos = new THREE.Vector3(0, 2, 0);
                this.player = new Player(this.camera, this.scene, startPos);
                this.currentLevelName = data.name || `第 ${levelNum} 关`;
            } catch (err) {
                console.error(err);
                this.buildFallbackLevel();
                // 回退场景：起点平台是手动创建的，同样需要计算顶部 + 偏移
                let startPos = null;
                for (const mesh of this.worldMeshes) {
                    if (mesh.userData.isStart) {
                        startPos = this.getSpawnPositionFromPlatform(mesh);
                        break;
                    }
                }
                if (!startPos) startPos = new THREE.Vector3(0, 2, 0);
                this.player = new Player(this.camera, this.scene, startPos);
                this.currentLevelName = `第 ${levelNum} 关 (默认场地)`;
            }
        }

        buildFallbackLevel() {
            const geo = new THREE.BoxGeometry(8, 0.5, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0x000000 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, 0, 0);
            mesh.receiveShadow = true;
            mesh.castShadow = true;
            mesh.userData.isGround = true;
            mesh.userData.isStart = true;
            mesh.userData.height = 0.5;  // 记录高度
            this.scene.add(mesh);
            this.worldMeshes.push(mesh);
            // 边缘线淡蓝
            const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x88aaff }));
            edge.position.copy(mesh.position);
            this.scene.add(edge);
        }

        migrateToV3(data) {
            let modified = false;
            if (!data.ver || parseFloat(data.ver) < 3.0) {
                let hasStartPlatform = (data.platforms || []).some(p => p.type === 1);
                if (!hasStartPlatform && data.startPosition) {
                    if (!data.platforms) data.platforms = [];
                    data.platforms.push({
                        id: (data.platforms.length + 1).toString(),
                        x: data.startPosition.x,
                        y: data.startPosition.y,
                        z: data.startPosition.z,
                        width: 8,
                        depth: 8,
                        height: 1,
                        type: 1,
                        tooltip: '',
                        tooltip_en: ''
                    });
                    modified = true;
                }
                (data.platforms || []).forEach(p => {
                    if (p.isGoal === true && !p.type) {
                        p.type = 3;
                        modified = true;
                    } else if (!p.type && p.type !== 0) {
                        p.type = 0;
                    }
                });
                data.ver = '3.0';
                modified = true;
            }
            return data;
        }

        buildLevel(data) {
            data = this.migrateToV3(data);

            let autoId = 1;
            (data.platforms || []).forEach(p => { if (!p.id) p.id = String(autoId++); });
            (data.walls || []).forEach(w => { if (!w.id) w.id = String(autoId++); });
            (data.decorations || []).forEach(d => { if (!d.id) d.id = String(autoId++); });

            (data.platforms || []).forEach(p => {
                const w = p.width || 10, d = p.depth || 20, h = p.height || 0.5;
                const geo = new THREE.BoxGeometry(w, h, d);
                const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6, metalness: 0.1 });
                const mesh = new THREE.Mesh(geo, mat);
                const initX = Array.isArray(p.x) ? safeRangeMid(p.x, 0) : (p.x ?? 0);
                const initY = Array.isArray(p.y) ? safeRangeMid(p.y, 0) : (p.y ?? 0);
                const initZ = Array.isArray(p.z) ? safeRangeMid(p.z, 0) : (p.z ?? 0);
                mesh.position.set(initX, initY, initZ);
                mesh.receiveShadow = true; mesh.castShadow = true;
                mesh.userData.isGround = true;
                mesh.userData.isStart = (p.type === 1);
                mesh.userData.isCheckpoint = (p.type === 2);
                mesh.userData.isGoal = (p.type === 3);
                mesh.userData.height = h;   // 记录高度，用于计算重生点
                if (p.type === 3) { this.goalPlatformMesh = mesh; this.goalPosition = mesh.position.clone(); }
                mesh.userData.tooltip = p.type === 3 ? '' : (p.tooltip || '');
                mesh.userData.tooltip_en = p.type === 3 ? '' : (p.tooltip_en || '');
                mesh.userData.id = p.id || '';
                this.scene.add(mesh); this.worldMeshes.push(mesh);
                if (p.type === 2) this.checkpointMeshes.push(mesh);

                let edgeColor = '#444444';
                if (p.type === 1) edgeColor = '#88aaff';
                else if (p.type === 2) edgeColor = '#88ffaa';
                else if (p.type === 3) edgeColor = '#ff8888';
                const edgeLine = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edgeColor }));
                edgeLine.position.copy(mesh.position); this.scene.add(edgeLine);

                const dynamicAxes = [];
                if (Array.isArray(p.x) && p.x.length >= 2) dynamicAxes.push({ axis: 'x', range: p.x, speed: Math.abs(p.speed || 0.5) || 0.5 });
                if (Array.isArray(p.y) && p.y.length >= 2) dynamicAxes.push({ axis: 'y', range: p.y, speed: Math.abs(p.speed || 0.5) || 0.5 });
                if (Array.isArray(p.z) && p.z.length >= 2) dynamicAxes.push({ axis: 'z', range: p.z, speed: Math.abs(p.speed || 0.5) || 0.5 });
                if (dynamicAxes.length > 0) {
                    this.dynamicObjects.push({ mesh, edgeLine, axes: dynamicAxes, startTime: performance.now() / 1000, type: 'platform' });
                }
            });

            (data.walls || []).forEach(w => {
                const width = w.width || 10, height = w.height || 3, depth = w.depth || 0.5;
                const geo = new THREE.BoxGeometry(width, height, depth);
                const mat = new THREE.MeshStandardMaterial({ color: CONFIG.environment.wallColor, roughness: 0.8, metalness: 0.1 });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(w.x, w.y + height/2, w.z);
                mesh.receiveShadow = true; mesh.castShadow = true;
                mesh.userData.isGround = false;
                mesh.userData.tooltip = ''; mesh.userData.tooltip_en = ''; mesh.userData.id = w.id || '';
                this.scene.add(mesh); this.wallMeshes.push(mesh);
                const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x888888 }));
                edge.position.copy(mesh.position); this.scene.add(edge);
            });

            (data.decorations || []).forEach(dec => {
                if (dec.type === 'arrow') {
                    const shape = new THREE.Shape();
                    shape.moveTo(0, 0.5); shape.lineTo(-1, -1); shape.lineTo(0, -0.5); shape.lineTo(1, -1); shape.closePath();
                    const geo = new THREE.ShapeGeometry(shape);
                    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
                    const arrow = new THREE.Mesh(geo, mat);
                    arrow.position.set(dec.x, dec.y, dec.z);
                    const orient = dec.orientation || 'forward';
                    if (orient === 'forward') arrow.rotation.x = -Math.PI / 2;
                    else if (orient === 'up') arrow.rotation.x = 0;
                    else if (orient === 'backward') { arrow.rotation.x = -Math.PI / 2; arrow.rotation.z = Math.PI; }
                    arrow.scale.set(dec.scale || 1, dec.scale || 1, dec.scale || 1);
                    arrow.userData.id = dec.id || '';
                    this.scene.add(arrow);
                }
            });
        }

        startChallengeTimer() {
            if (this.mode !== 'challenge') return;
            if (this.challengeTimerRunning) this.stopChallengeTimer();
            this.challengeTimeLeft = CONFIG.challenge.timeLimit;
            if (challengeTimerEl) challengeTimerEl.textContent = this.challengeTimeLeft;
            this.challengeTimerRunning = true;
            this.lastTimerUpdate = performance.now();
            this._updateChallengeTimer();
        }

        stopChallengeTimer() {
            this.challengeTimerRunning = false;
        }

        _updateChallengeTimer() {
            if (!this.challengeTimerRunning) return;
            if (this.transitioning || this.paused) {
                requestAnimationFrame(() => this._updateChallengeTimer());
                return;
            }
            const now = performance.now();
            const elapsed = (now - this.lastTimerUpdate) / 1000;
            if (elapsed >= 1) {
                const decrement = Math.floor(elapsed);
                this.challengeTimeLeft -= decrement;
                if (challengeTimerEl) challengeTimerEl.textContent = this.challengeTimeLeft;
                this.lastTimerUpdate = now;
                if (this.challengeTimeLeft <= 0) {
                    this.challengeTimerRunning = false;
                    this.showChallengeFail();
                    return;
                }
            }
            requestAnimationFrame(() => this._updateChallengeTimer());
        }

        showChallengeFail() {
            this.transitioning = true;
            this.paused = true;
            this.stopChallengeTimer();
            if (challengeFailEl) challengeFailEl.classList.remove('fail-hidden');
        }

        resetInputState() {
            this.moveTouchId = null; this.viewTouchId = null;
            this.input.move = { x: 0, y: 0 };
            this.input.jump = false;
            this.keyJumpConsumed = false;
            this.pendingJump = false;
        }

        setupSkipButton() {
            if (!skipBtn) return;
            skipBtn.addEventListener('click', () => {
                if (this.transitioning || this.mode !== 'trial') return;
                this.transitionToNextLevel();
            });
        }

        setupInput() {
            const container = gameContainer;
            if (!container) return;
            const midX = () => window.innerWidth / 2;
            container.addEventListener('touchstart', (e) => {
                if (this.transitioning || this.paused) return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    if (touch.clientX < midX()) {
                        if (this.moveTouchId !== null) continue;
                        this.moveTouchId = touch.identifier;
                        this.moveStart = { x: touch.clientX, y: touch.clientY };
                    } else {
                        if (this.viewTouchId !== null) continue;
                        this.viewTouchId = touch.identifier;
                        this.touchStartTime = performance.now();
                        this.touchStartPos = { x: touch.clientX, y: touch.clientY };
                        this.pendingJump = true;
                        this.lastRotation = { x: touch.clientX, y: touch.clientY };
                    }
                }
            }, { passive: false });
            container.addEventListener('touchmove', (e) => {
                if (this.transitioning || this.paused) return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    if (touch.identifier === this.moveTouchId) {
                        const dx = touch.clientX - this.moveStart.x, dy = touch.clientY - this.moveStart.y;
                        this.input.move = { x: Math.max(-1, Math.min(1, dx / 80)), y: Math.max(-1, Math.min(1, -dy / 80)) };
                    } else if (touch.identifier === this.viewTouchId) {
                        const threshold = window.innerWidth * 0.05;
                        if (Math.abs(touch.clientX - this.touchStartPos.x) > threshold || Math.abs(touch.clientY - this.touchStartPos.y) > threshold) this.pendingJump = false;
                        if (this.lastRotation.x !== 0 || this.lastRotation.y !== 0) {
                            if (this.player) this.player.rotate(touch.clientX - this.lastRotation.x, touch.clientY - this.lastRotation.y);
                        }
                        this.lastRotation = { x: touch.clientX, y: touch.clientY };
                    }
                }
            }, { passive: false });
            container.addEventListener('touchend', (e) => {
                if (this.transitioning || this.paused) return;
                e.preventDefault();
                for (const touch of e.changedTouches) {
                    if (touch.identifier === this.moveTouchId) { this.moveTouchId = null; this.input.move = { x: 0, y: 0 }; }
                    else if (touch.identifier === this.viewTouchId) {
                        if (this.pendingJump && (performance.now() - this.touchStartTime) < 150) this.input.jump = true;
                        this.viewTouchId = null; this.pendingJump = false; this.lastRotation = { x: 0, y: 0 };
                    }
                }
            });
            const keys = {};
            window.addEventListener('keydown', (e) => {
                if (this.transitioning || this.paused) return;
                keys[e.key.toLowerCase()] = true;
                this.input.move = {
                    x: (keys['a'] || keys['arrowleft'] ? -1 : 0) + (keys['d'] || keys['arrowright'] ? 1 : 0),
                    y: (keys['w'] || keys['arrowup'] ? 1 : 0) + (keys['s'] || keys['arrowdown'] ? -1 : 0)
                };
                if (e.key === ' ') { e.preventDefault(); if (!this.keyJumpConsumed) { this.input.jump = true; this.keyJumpConsumed = true; } }
            });
            window.addEventListener('keyup', (e) => {
                if (this.transitioning || this.paused) return;
                keys[e.key.toLowerCase()] = false;
                this.input.move = {
                    x: (keys['a'] || keys['arrowleft'] ? -1 : 0) + (keys['d'] || keys['arrowright'] ? 1 : 0),
                    y: (keys['w'] || keys['arrowup'] ? 1 : 0) + (keys['s'] || keys['arrowdown'] ? -1 : 0)
                };
                if (e.key === ' ') { this.input.jump = false; this.keyJumpConsumed = false; }
            });
        }

        updateDynamicObjects(now) {
            for (const dyn of this.dynamicObjects) {
                if (dyn.type !== 'platform') continue;
                const elapsed = now - dyn.startTime;
                for (const axisData of dyn.axes) {
                    const speed = Math.abs(axisData.speed) || 0.5;
                    const range = axisData.range;
                    if (!Array.isArray(range) || range.length < 2) continue;
                    const t = Math.sin(elapsed * speed * 2 * Math.PI) * 0.5 + 0.5;
                    const value = range[0] + (range[1] - range[0]) * t;
                    if (isNaN(value)) continue;
                    if (axisData.axis === 'x') dyn.mesh.position.x = value;
                    else if (axisData.axis === 'y') dyn.mesh.position.y = value;
                    else if (axisData.axis === 'z') dyn.mesh.position.z = value;
                }
                if (dyn.edgeLine) dyn.edgeLine.position.copy(dyn.mesh.position);
            }
        }

        showTooltip(cnText, enText) {
            if (!tooltipEl) return;
            tooltipEl.innerHTML = '';
            tooltipEl.style.display = 'flex';
            tooltipEl.style.flexDirection = 'column';
            tooltipEl.style.alignItems = 'center';
            tooltipEl.style.justifyContent = 'center';

            if (enText && enText.trim() !== '') {
                const enLine = document.createElement('div');
                enLine.textContent = enText;
                enLine.style.fontSize = '24px';
                enLine.style.fontWeight = 'bold';
                enLine.style.color = '#ffffff';
                enLine.style.textShadow = '0 0 12px rgba(0,0,0,0.8)';
                enLine.style.lineHeight = '1.3';
                enLine.style.maxWidth = '80vw';
                enLine.style.textAlign = 'center';
                enLine.style.whiteSpace = 'pre-wrap';
                enLine.style.wordBreak = 'break-word';
                tooltipEl.appendChild(enLine);

                const cnLine = document.createElement('div');
                cnLine.textContent = cnText;
                cnLine.style.fontSize = '14px';
                cnLine.style.color = '#dddddd';
                cnLine.style.textShadow = '0 0 8px rgba(0,0,0,0.6)';
                cnLine.style.lineHeight = '1.2';
                cnLine.style.maxWidth = '80vw';
                cnLine.style.textAlign = 'center';
                cnLine.style.whiteSpace = 'pre-wrap';
                cnLine.style.wordBreak = 'break-word';
                cnLine.style.marginTop = '4px';
                tooltipEl.appendChild(cnLine);
            } else {
                const cnLine = document.createElement('div');
                cnLine.textContent = cnText;
                cnLine.style.fontSize = '28px';
                cnLine.style.fontWeight = 'bold';
                cnLine.style.color = '#ffffff';
                cnLine.style.textShadow = '0 0 20px rgba(0,0,0,0.9)';
                cnLine.style.textAlign = 'center';
                cnLine.style.maxWidth = '80vw';
                cnLine.style.whiteSpace = 'pre-wrap';
                cnLine.style.wordBreak = 'break-word';
                tooltipEl.appendChild(cnLine);
            }

            tooltipEl.classList.add('show');
            clearTimeout(this._tooltipTimeout);
            this._tooltipTimeout = setTimeout(() => {
                tooltipEl.classList.remove('show');
            }, 3000);
        }

        checkTooltip() {
            if (!this.player || !this.player.currentGroundMesh) return;
            const mesh = this.player.currentGroundMesh;
            if (mesh.userData.isGoal) return;
            const cn = mesh.userData.tooltip;
            if (!cn || cn === '') return;
            if (this.shownTooltips.has(mesh.uuid)) return;
            this.shownTooltips.add(mesh.uuid);
            const en = mesh.userData.tooltip_en || '';
            this.showTooltip(cn, en);
        }

        processCameraFlight(dt, now) {
            const cf = this.cameraFlight;
            if (!cf) return false;
            if (cf.phase === 'toGoal') {
                const elapsed = now - cf.phaseStart;
                const t = Math.min(elapsed / cf.toGoalDuration, 1.0);
                this.camera.position.lerpVectors(cf.from, cf.toGoalPos, t);
                this.camera.lookAt(cf.goalLookAt);
                if (t >= 1.0) { cf.phase = 'atGoal'; cf.phaseStart = now; }
            } else if (cf.phase === 'atGoal') {
                if (now - cf.phaseStart >= 1.0) {
                    cf.phase = 'toStart'; cf.phaseStart = now;
                    cf.from.copy(this.camera.position);
                }
            } else if (cf.phase === 'toStart') {
                const elapsed = now - cf.phaseStart;
                const t = Math.min(elapsed / cf.toStartDuration, 1.0);
                this.camera.position.lerpVectors(cf.from, cf.startPos, t);
                this.camera.lookAt(cf.goalLookAt);
                if (t >= 1.0) {
                    this.camera.position.copy(cf.startPos);
                    this.camera.lookAt(cf.goalLookAt);
                    if (this.player) {
                        const dir = new THREE.Vector3().subVectors(cf.goalLookAt, cf.startPos).normalize();
                        this.player.yaw = Math.atan2(-dir.x, -dir.z);
                        this.player.pitch = Math.asin(dir.y) || 0;
                        this.player.camera.position.copy(cf.startPos);
                        this.player.camera.rotation.y = this.player.yaw;
                        this.player.camera.rotation.x = this.player.pitch;
                    }
                    this.cameraFlight = null;
                    return true;
                }
            }
            return false;
        }

        async transitionToNextLevel() {
            if (this.transitioning) return;
            this.transitioning = true;
            if (skipBtn) { skipBtn.style.pointerEvents = 'none'; skipBtn.style.opacity = '0.5'; }
            this.stopChallengeTimer();
            const nextLevel = this.currentLevel + 1;
            try { localStorage.setItem('blockRunLevel', nextLevel); } catch(e) {}
            if (transitionOverlay) {
                transitionOverlay.style.transition = 'opacity 0.8s';
                transitionOverlay.style.opacity = '1';
                await new Promise(r => setTimeout(r, 600));
            }
            this.currentLevel = nextLevel;
            await this.loadLevel(this.currentLevel);
            showLevelTitle(this.currentLevelName);
            await new Promise(r => setTimeout(r, 1200));
            if (transitionOverlay) transitionOverlay.style.opacity = '0';
            await new Promise(r => setTimeout(r, 500));

            const startPos = this.player ? this.player.startPosition.clone() : new THREE.Vector3(0,2,0);
            let goalPos = this.goalPosition ? this.goalPosition.clone() : startPos.clone().add(new THREE.Vector3(0,0,10));
            const goalLookAt = goalPos.clone();
            const toGoalPos = goalPos.clone().add(new THREE.Vector3(0, CONFIG.environment.cameraGoalHeight, 0));
            this.cameraFlight = {
                phase: 'toGoal', phaseStart: performance.now() / 1000,
                from: startPos.clone(), toGoalPos, goalLookAt,
                startPos: startPos.clone(), toGoalDuration: 1.0, toStartDuration: 2.0
            };
            await new Promise(resolve => { this._flightResolve = resolve; });
            animateDivider();
            await new Promise(r => setTimeout(r, 1300));
            if (skipBtn && this.mode === 'trial') { skipBtn.style.pointerEvents = 'auto'; skipBtn.style.opacity = '0.7'; }
            this.transitioning = false;
            if (this.mode === 'challenge') this.startChallengeTimer();
        }

        animate() {
            requestAnimationFrame(() => this.animate());
            const dt = Math.min(this.clock.getDelta(), 0.1);
            const now = performance.now() / 1000;
            if (this.cameraFlight) {
                const finished = this.processCameraFlight(dt, now);
                this.renderer.render(this.scene, this.camera);
                if (finished && this._flightResolve) { this._flightResolve(); this._flightResolve = null; }
                return;
            }
            if (this.transitioning || this.paused) {
                this.renderer.render(this.scene, this.camera);
                return;
            }
            this.updateDynamicObjects(now);
            if (this.player) {
                this.player.update(dt, this.input, this.worldMeshes, this.wallMeshes);
                this.updateSkyAndLighting(this.player.position);
                this.input.jump = false;
                this.checkTooltip();
                this.checkAndUpdateCheckpoint();
                if (this.goalPlatformMesh && this.player.currentGroundMesh === this.goalPlatformMesh && !this.player.isClimbing) {
                    this.goalStandTimer += dt;
                    if (this.goalStandTimer >= this.goalRequiredTime && !this.goalReached) {
                        this.goalReached = true;
                        this.stopChallengeTimer();
                        this.transitionToNextLevel();
                    }
                } else { this.goalStandTimer = 0; this.goalReached = false; }
            }
            this.renderer.render(this.scene, this.camera);
        }

        onResize() {
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
        }

        cleanup() {
            this.disablePointerLock();
            this.clearScene();
            this.stopChallengeTimer();
        }
    }

    // ==================== 动态关卡加载系统 ====================
    let currentMaxLevel = 0;
    let isLoadingMore = false;

    async function fetchLevelMeta(num) {
        try {
            const resp = await fetch(`map/level${num}.json`);
            if (!resp.ok) return { exists: false, num };
            const data = await resp.json();
            return { exists: true, num, name: data.name || `第 ${num} 关` };
        } catch {
            return { exists: false, num };
        }
    }

    function addLevelItemToList(listEl, num, name, mode) {
        if (listEl.querySelector(`.level-item[data-level="${num}"]`)) return;
        const div = document.createElement('div');
        div.className = 'level-item';
        div.setAttribute('data-level', num);
        div.textContent = name;
        const saved = parseInt(localStorage.getItem('blockRunLevel'));
        if (num < saved) div.classList.add('completed');
        div.addEventListener('click', () => startGameFromMenu(num, mode));
        listEl.appendChild(div);
        if (num > currentMaxLevel) currentMaxLevel = num;
    }

    async function loadLevelList(mode, startFrom = 1) {
        const listId = mode === 'trial' ? 'trial-levels' : 'challenge-levels';
        const listEl = document.getElementById(listId);
        if (!listEl || isLoadingMore) return;
        isLoadingMore = true;

        let nextId = startFrom;
        let emptyBatchCount = 0;
        const BATCH_SIZE = CONFIG.levelLoad.concurrent;
        const MAX_EMPTY_BATCHES = 3;

        while (emptyBatchCount < MAX_EMPTY_BATCHES) {
            const batch = [];
            for (let i = 0; i < BATCH_SIZE; i++) {
                batch.push(fetchLevelMeta(nextId + i));
            }
            const results = await Promise.all(batch);
            let anyFound = false;
            for (const res of results) {
                if (res && res.exists) {
                    anyFound = true;
                    addLevelItemToList(listEl, res.num, res.name, mode);
                }
            }
            if (!anyFound) {
                emptyBatchCount++;
            } else {
                emptyBatchCount = 0;
            }
            nextId += BATCH_SIZE;
        }

        const loadingEl = document.getElementById(mode === 'trial' ? 'trial-loading' : 'challenge-loading');
        if (loadingEl) loadingEl.textContent = '没有更多关卡';
        isLoadingMore = false;
    }

    function initMenu() {
        const tabs = document.querySelectorAll('.menu-tab');
        const panels = document.querySelectorAll('.tab-panel');
        let currentTab = 0;

        function switchTab(index) {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tabs[index].classList.add('active');
            panels[index].classList.add('active');
            currentTab = index;
            if (index === 0) loadLevelList('trial', 1);
            if (index === 1) loadLevelList('challenge', 1);
        }

        tabs.forEach((tab, i) => tab.addEventListener('click', () => switchTab(i)));

        const contentArea = document.getElementById('menu-content');
        if (contentArea) {
            let touchStartX = 0;
            contentArea.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].clientX; });
            contentArea.addEventListener('touchend', e => {
                const dx = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(dx) > 50) {
                    if (dx < 0 && currentTab < 3) switchTab(currentTab + 1);
                    else if (dx > 0 && currentTab > 0) switchTab(currentTab - 1);
                }
            });
        }

        ['trial-levels', 'challenge-levels'].forEach(id => {
            const listEl = document.getElementById(id);
            if (listEl) {
                const panel = listEl.parentElement;
                panel.addEventListener('scroll', () => {
                    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 60) {
                        const mode = id === 'trial-levels' ? 'trial' : 'challenge';
                        const nextStart = currentMaxLevel + 1;
                        if (!isLoadingMore && nextStart > 1) {
                            loadLevelList(mode, nextStart);
                        }
                    }
                });
            }
        });

        switchTab(0);
    }

    function startGameFromMenu(levelNum, mode) {
        if (game && game.transitioning) return;
        currentMode = mode;
        mainMenu.classList.add('menu-hidden');
        gameContainer.classList.remove('game-hidden');
        if (challengeFailEl) challengeFailEl.classList.add('fail-hidden');
        if (!game) {
            game = new Game(canvas);
            window.addEventListener('resize', () => game.onResize());
        }
        if (game) { game.resetInputState(); game.paused = false; }
        game.startLevel(levelNum, mode);
    }

    if (menuContinueBtn) {
        menuContinueBtn.addEventListener('click', () => {
            const saved = parseInt(localStorage.getItem('blockRunLevel'));
            const target = saved && saved >= 1 ? saved : 1;
            startGameFromMenu(target, 'trial');
        });
    }

    const failMenuBtn = document.getElementById('fail-menu');
    const failRetryBtn = document.getElementById('fail-retry');
    if (failMenuBtn) {
        failMenuBtn.addEventListener('click', () => {
            if (game) {
                game.cleanup();
                gameContainer.classList.add('game-hidden');
                mainMenu.classList.remove('menu-hidden');
                if (challengeFailEl) challengeFailEl.classList.add('fail-hidden');
            }
        });
    }
    if (failRetryBtn) {
        failRetryBtn.addEventListener('click', () => {
            if (game) {
                if (challengeFailEl) challengeFailEl.classList.add('fail-hidden');
                game.resetInputState();
                game.startLevel(game.currentLevel, 'challenge');
            }
        });
    }

    // ==================== 启动 ====================
    async function boot() {
        logoOverlay.classList.remove('hidden');
        prepareBackgroundMusic();
        await preloadMoonTexture();
        await new Promise(r => setTimeout(r, 4500));
        logoOverlay.classList.add('hidden');
        mainMenu.classList.remove('menu-hidden');
        initMenu();
    }

    boot().catch(console.error);
})();