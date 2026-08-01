cameraPos = [];
numOfCoins = 300;
numOfDownboards = 200;
numOfFlies = 5;
coinarr = [];
trainarr = [];
downboardarr = [];
upboardarr = [];
conesarr = [];
flyarr = [];
bootsarr = [];
magnetarr = [];
Score = 0;
textureOn = 1;
grayscale = 0;
textureprogramInfo = '';
nontextureprogramInfo = '';
groundtexture = '';
walltexture = '';
woodtexture = '';
metaltexture = '';
traintexture = '';
skytexture = '';
redtexture = '';
bluetexture = '';
goldtexture = '';
downtexture = '';
endtexture = '';
flashTime = 0;
totalTime = 0;
let _gameOver = false;

/**
 * sleep() — originally undefined, caused crashes on every collision.
 * Now triggers a proper game-over: stops the loop, shows overlay.
 */
function sleep(ms) {
  if (_gameOver) return;
  _gameOver = true;
  // Stop the game loop by zeroing speed factor
  window._gameSpeedFactor = 0;
  // Show game-over overlay
  const overlay = document.getElementById('gameover-overlay');
  const finalScore = document.getElementById('gameover-score');
  if (overlay) {
    if (finalScore) finalScore.innerText = 'SCORE: ' + Score;
    overlay.style.display = 'flex';
  }
}

function restartGame() {
  _gameOver = false;
  window._gameSpeedFactor = 1.0;
  const overlay = document.getElementById('gameover-overlay');
  if (overlay) overlay.style.display = 'none';
  // Re-init everything
  cameraPos = [];
  Score = 0;
  coinarr = []; trainarr = []; downboardarr = []; upboardarr = [];
  conesarr = []; flyarr = []; bootsarr = []; magnetarr = [];
  flashTime = 0; totalTime = 0;
  const gl = document.querySelector('#glcanvas').getContext('webgl') ||
             document.querySelector('#glcanvas').getContext('experimental-webgl');
  if (gl) initBuffers(gl);
}

main();

function isPowerOf2(value) {
  return (value & (value - 1)) == 0;
}

function main() {
  const canvas = document.querySelector('#glcanvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) {
    alert('Unable to initialize WebGL. Your browser or machine may not support it.');
    return;
  }
  groundtexture = loadTexture(gl, 'static/ground.jpg');
  walltexture   = loadTexture(gl, 'static/wall.jpg');
  woodtexture   = loadTexture(gl, 'static/wood.jpg');
  metaltexture  = loadTexture(gl, 'static/tracks.jpg');
  traintexture  = loadTexture(gl, 'static/train.jpg');
  skytexture    = loadTexture(gl, 'static/sky.jpg');
  redtexture    = loadTexture(gl, 'static/red.jpeg');
  bluetexture   = loadTexture(gl, 'static/blue.jpg');
  goldtexture   = loadTexture(gl, 'static/gold.jpg');
  downtexture   = loadTexture(gl, 'static/down.jpg');
  endtexture    = loadTexture(gl, 'static/end.jpg');

  initBuffers(gl);

  var then = 0;
  resetsources(gl);
  function render(now) {
    now *= 0.001;
    const deltaTime = now - then;
    then = now;

    const effectiveDelta = deltaTime * (window._gameSpeedFactor !== undefined ? window._gameSpeedFactor : 1.0);

    if (window._gameSpeedFactor !== 0 && !_gameOver) {
      tickElements(gl);
    }

    drawScene(gl, effectiveDelta);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

function resetsources(gl){
  vsSource = `
    attribute vec4 aVertexPosition;
    attribute vec4 aVertexColor;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    varying lowp vec4 vColor;
    void main(void) {
      gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
      vColor = aVertexColor;
    }
  `;
  fsSource = `
    varying lowp vec4 vColor;
    void main(void) {
      gl_FragColor = vColor;
    }
  `;
  shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  nontextureprogramInfo = {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
      vertexColor:    gl.getAttribLocation(shaderProgram, 'aVertexColor'),
    },
    uniformLocations: {
      projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
      modelViewMatrix:  gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
    },
  };
  vsSource = `
    attribute vec4 aVertexPosition;
    attribute vec2 aTextureCoord;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    varying highp vec2 vTextureCoord;
    void main(void) {
      gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
      vTextureCoord = aTextureCoord;
    }
  `;
  fsSource = `
    varying highp vec2 vTextureCoord;
    uniform sampler2D uSampler;
    void main(void) {
      gl_FragColor = texture2D(uSampler, vTextureCoord);
    }
  `;
  shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  textureprogramInfo = {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
      textureCoord:   gl.getAttribLocation(shaderProgram, 'aTextureCoord'),
    },
    uniformLocations: {
      projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
      modelViewMatrix:  gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
      uSampler:         gl.getUniformLocation(shaderProgram, 'uSampler'),
    },
  };
  vsSource = `
    attribute vec4 a_position;
    attribute vec4 a_color;
    attribute vec2 a_texCoord0;
    uniform mat4 u_modelviewTrans;
    uniform mat4 u_projTrans;
    varying lowp vec4 v_color;
    varying highp vec2 v_texCoords;
    void main() {
      gl_Position = u_projTrans * u_modelviewTrans * a_position;
      v_color = a_color;
      v_texCoords = a_texCoord0;
    }
  `;
  fsSource = `
    precision mediump float;
    varying lowp vec4 v_color;
    varying highp vec2 v_texCoords;
    uniform sampler2D u_texture;
    void main() {
      vec4 color = texture2D(u_texture, v_texCoords);
      float graycolor = 0.299*color.r + 0.587*color.g + 0.114*color.b;
      gl_FragColor = vec4(vec3(graycolor), color.a);
    }
  `;
  shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  grayscaleprogramInfo = {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'a_position'),
      textureCoord:   gl.getAttribLocation(shaderProgram, 'a_texCoord0'),
    },
    uniformLocations: {
      projectionMatrix: gl.getUniformLocation(shaderProgram, 'u_projTrans'),
      modelViewMatrix:  gl.getUniformLocation(shaderProgram, 'u_modelviewTrans'),
      uSampler:         gl.getUniformLocation(shaderProgram, 'u_texture'),
    },
  };
  vsSource = `
    attribute vec4 a_position;
    attribute vec4 a_color;
    attribute vec2 a_texCoord0;
    uniform mat4 u_modelviewTrans;
    uniform mat4 u_projTrans;
    varying lowp vec4 v_color;
    varying highp vec2 v_texCoords;
    void main() {
      gl_Position = u_projTrans * u_modelviewTrans * a_position;
      v_color = a_color;
      v_texCoords = a_texCoord0;
    }
  `;
  fsSource = `
    precision mediump float;
    varying lowp vec4 v_color;
    varying highp vec2 v_texCoords;
    uniform sampler2D u_texture;
    void main() {
      vec4 color = texture2D(u_texture, v_texCoords);
      gl_FragColor = vec4(1.2*color.r, 1.2*color.g, 1.2*color.b, color.a);
    }
  `;
  shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  flashprogramInfo = {
    program: shaderProgram,
    attribLocations: {
      vertexPosition: gl.getAttribLocation(shaderProgram, 'a_position'),
      textureCoord:   gl.getAttribLocation(shaderProgram, 'a_texCoord0'),
    },
    uniformLocations: {
      projectionMatrix: gl.getUniformLocation(shaderProgram, 'u_projTrans'),
      modelViewMatrix:  gl.getUniformLocation(shaderProgram, 'u_modelviewTrans'),
      uSampler:         gl.getUniformLocation(shaderProgram, 'u_texture'),
    },
  };
}

function texture(){
  textureOn = textureOn == 0 ? 1 : 0;
}
function grayfn(){
  grayscale = grayscale == 0 ? 1 : 0;
}

function tickElements(gl) {
  totalTime++;
  if (totalTime > 4950) {
    sleep(100);
    return;
  }

  surfer.tick();
  flashTime++;
  if (Math.floor((Math.random()*100)+1) == 1) flashTime = 0;

  police.tick(surfer.position[0]);

  if (police.position[2]-surfer.position[2] < 2 && Math.abs(police.position[1]-surfer.position[1]) < 0.2) {
    sleep(100); return;
  }
  if (police.position[2]-surfer.position[2] < 6) {
    surfer.position[2] -= 0.005;
  }

  cameraPos = [surfer.position[0], Math.max(surfer.position[1]+1.5, 1.3), surfer.position[2]+6.0];

  for (var i = 0; i < numOfCoins; i++) {
    if (coinarr[i].taken == 0) {
      coinarr[i].tick();
      var dist = (coinarr[i].position[0]-surfer.position[0])**2 +
                 (coinarr[i].position[1]-surfer.position[1])**2 +
                 (coinarr[i].position[2]-surfer.position[2])**2;
      if (surfer.magnettime < 500 && dist < 10) {
        coinarr[i].move([
          surfer.position[0]-coinarr[i].position[0],
          surfer.position[1]-coinarr[i].position[1],
          surfer.position[2]-coinarr[i].position[2]
        ], dist);
      }
      if (dist < 0.3) { coinarr[i].taken = 1; Score++; }
    }
  }

  // Update score display safely
  const scEl = document.getElementById('sc');
  if (scEl) scEl.innerText = 'Score: ' + Score;
  const topScore = document.getElementById('score-display');
  if (topScore) topScore.innerText = 'SCORE: ' + Score;

  for (var i = 0; i < numOfDownboards; i++) {
    if (((downboardarr[i].position[0]-surfer.position[0])**2 +
         (downboardarr[i].position[1]-0.5-surfer.position[1])**2 +
         (downboardarr[i].position[2]-surfer.position[2])**2 < 0.4) &&
        surfer.position[2] > downboardarr[i].position[2]) {
      sleep(100); return;
    }
    if (((upboardarr[i].position[0]-surfer.position[0])**2 +
         (upboardarr[i].position[1]-surfer.position[1])**2 +
         (upboardarr[i].position[2]-surfer.position[2])**2 < 2.0) &&
        surfer.position[2] > upboardarr[i].position[2]) {
      sleep(100); return;
    }
    if (((conesarr[i].position[0]-surfer.position[0])**2 +
         (conesarr[i].position[1]-surfer.position[1])**2 +
         (conesarr[i].position[2]-surfer.position[2])**2 < 0.3) &&
        surfer.position[2] > conesarr[i].position[2]) {
      surfer.speed[2] = -0.08;
    }
    if (((trainarr[i].position[0]-surfer.position[0])**2 +
         (trainarr[i].position[1]-surfer.position[1])**2 < 0.3) &&
        surfer.position[2]-trainarr[i].position[2] < 10.0 &&
        surfer.position[2] > trainarr[i].position[2]) {
      sleep(100); return;
    }
  }

  for (var i = 0; i < numOfFlies; i++) {
    if (flyarr[i].taken == 0) {
      flyarr[i].tick();
      if (((flyarr[i].position[0]-surfer.position[0])**2 +
           (flyarr[i].position[1]-surfer.position[1]-0.5)**2 +
           (flyarr[i].position[2]-surfer.position[2])**2 < 0.2) &&
          surfer.position[2] > flyarr[i].position[2]) {
        flyarr[i].taken = 1;
        superJumptime = 580;
        surfer.flytime = 0;
        numOfCoins += 20;
        for (var j = 0; j < 20; j++) {
          coinarr.push(new Coin(gl, [
            Math.floor(Math.random()*2+1)==1 ? -1.1 : 1.1,
            5.24, surfer.position[2]-7*j
          ]));
        }
        break;
      }
    }
    if (bootsarr[i].taken == 0) {
      bootsarr[i].tick();
      if (((bootsarr[i].position[0]-surfer.position[0])**2 +
           (bootsarr[i].position[1]-surfer.position[1])**2 +
           (bootsarr[i].position[2]-surfer.position[2])**2 < 0.3) &&
          surfer.position[2] > bootsarr[i].position[2]) {
        bootsarr[i].taken = 1;
        surfer.superJumptime = 0;
        break;
      }
    }
    if (magnetarr[i].taken == 0) {
      magnetarr[i].tick();
      if (((magnetarr[i].position[0]-surfer.position[0])**2 +
           (magnetarr[i].position[1]-surfer.position[1])**2 +
           (magnetarr[i].position[2]-surfer.position[2])**2 < 0.3) &&
          surfer.position[2] > magnetarr[i].position[2]) {
        magnetarr[i].taken = 1;
        surfer.magnettime = 0;
        break;
      }
    }
  }
}

function initBuffers(gl) {
  bg      = new Bg(gl);
  ground  = new Ground(gl);
  track1  = new Track(gl, [1.1, 0.0, 0.0]);
  track2  = new Track(gl, [-1.1, 0.0, 0.0]);
  surfer  = new Surfer(gl, [-1.0, -0.5, -8.0]);
  wall1   = new Wall(gl, [-3.0, 0.0, 0.0]);
  wall2   = new Wall(gl, [3.0, 0.0, 0.0]);
  police  = new Police(gl, [-1.0, -0.5, -5.0]);
  sun     = new Sun(gl);
  end     = new End(gl, [0.0, 1.0, -1000.0]);

  // Keydown registered ONCE
  if (!window._keyListenerAdded) {
    window._keyListenerAdded = true;
    document.addEventListener('keydown', function(event) {
      if (window._gameSpeedFactor === 0 || _gameOver) return;
      if      (event.keyCode == 37) surfer.moveLeft();
      else if (event.keyCode == 39) surfer.moveRight();
      else if (event.keyCode == 32) surfer.jump();
      else if (event.keyCode == 40) surfer.duck();
    });
  }

  for (var i = 0; i < numOfCoins; i++) {
    coinarr.push(new Coin(gl, [Math.floor(Math.random()*2+1)==1 ? -1.1 : 1.1, -0.2, -10*i]));
  }
  for (var i = 1; i <= numOfDownboards; i++) {
    downboardarr.push(new Downboard(gl, [Math.floor(Math.random()*2+1)==1 ? -1.1 : 1.1, -0.2, -67*i]));
    upboardarr.push(new Upboard(gl,    [Math.floor(Math.random()*2+1)==1 ? -1.1 : 1.1,  1.0, -83*i]));
    conesarr.push(new Cones(gl,        [Math.floor(Math.random()*2+1)==1 ? -1.1 : 1.1, -0.7, -109*i]));
    trainarr.push(new Train(gl,        [Math.floor(Math.random()*2+1)==1 ? -1.1 : 1.1, -0.7, -117*i]));
  }
  for (var i = 1; i <= numOfFlies; i++) {
    flyarr.push(new Fly(gl,       [Math.floor(Math.random()*2+1)==1 ?  1.1 : -1.1,  0.2, -201*i]));
    bootsarr.push(new Boots(gl,   [Math.floor(Math.random()*2+1)==1 ?  1.1 : -1.1,  0.0, -189*i]));
    magnetarr.push(new Magnet(gl, [Math.floor(Math.random()*2+1)==1 ?  1.1 : -1.1,  0.0,  -89*i]));
  }
}

function drawScene(gl, deltaTime) {
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const fieldOfView = 60 * Math.PI / 180;
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
  const zNear = 0.1;
  const zFar = 10000.0;
  const projectionMatrix = mat4.create();
  mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);

  var cameraMatrix = mat4.create();
  mat4.translate(cameraMatrix, cameraMatrix, cameraPos);
  var cameraPosition = [cameraMatrix[12], cameraMatrix[13], cameraMatrix[14]];
  var up = [0, 1, 0];
  mat4.lookAt(cameraMatrix, cameraPosition, [cameraPos[0], cameraPos[1], cameraPos[2]-2.0], up);

  var viewProjectionMatrix = mat4.create();
  mat4.multiply(viewProjectionMatrix, projectionMatrix, cameraMatrix);

  const pi  = textureOn==1 ? (grayscale==1 ? grayscaleprogramInfo : textureprogramInfo) : nontextureprogramInfo;
  const pi2 = (textureOn==1 && flashTime<10) ? flashprogramInfo : pi;

  end.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, endtexture);
  ground.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, groundtexture);
  wall1.draw(gl, viewProjectionMatrix, pi2, deltaTime, textureOn, walltexture);
  wall2.draw(gl, viewProjectionMatrix, pi2, deltaTime, textureOn, walltexture);
  track1.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, metaltexture);
  track2.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, metaltexture);
  bg.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, skytexture);
  surfer.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, redtexture);
  police.draw(gl, viewProjectionMatrix, pi, deltaTime, textureOn, bluetexture);
  sun.draw(gl, viewProjectionMatrix, nontextureprogramInfo, deltaTime);

  for (var i = 0; i < numOfCoins; i++) {
    if (coinarr[i].taken == 0) {
      coinarr[i].draw(gl, viewProjectionMatrix, textureOn==0 ? nontextureprogramInfo : (grayscale==1 ? grayscaleprogramInfo : textureprogramInfo), deltaTime, textureOn, goldtexture);
    }
  }
  for (var i = 0; i < numOfDownboards; i++) {
    const bpi = textureOn==0 ? nontextureprogramInfo : (grayscale==1 ? grayscaleprogramInfo : textureprogramInfo);
    downboardarr[i].draw(gl, viewProjectionMatrix, bpi, deltaTime, textureOn, downtexture);
    upboardarr[i].draw(gl, viewProjectionMatrix, bpi, deltaTime, textureOn, woodtexture);
    trainarr[i].draw(gl, viewProjectionMatrix, bpi, deltaTime, textureOn, traintexture);
    conesarr[i].draw(gl, viewProjectionMatrix, nontextureprogramInfo, deltaTime);
  }
  for (var i = 0; i < numOfFlies; i++) {
    if (flyarr[i].taken==0)    flyarr[i].draw(gl, viewProjectionMatrix, nontextureprogramInfo, deltaTime);
    if (bootsarr[i].taken==0)  bootsarr[i].draw(gl, viewProjectionMatrix, nontextureprogramInfo, deltaTime);
    if (magnetarr[i].taken==0) magnetarr[i].draw(gl, viewProjectionMatrix, nontextureprogramInfo, deltaTime);
  }
}

function initShaderProgram(gl, vsSource, fsSource) {
  const vertexShader   = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
  