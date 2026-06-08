
function createTheaterLayer() {
  if (document.querySelector(".theater-layer")) return;

  const layer = document.createElement("div");
  layer.className = "theater-layer";
  layer.innerHTML = `
    <div class="scene scene-1" data-zone="left">
      <div class="scene-title">Robot Watering Garden</div>
      <div class="scene-stage">
        <div class="robot-walker">
          <div class="robot-leg one"></div>
          <div class="robot-leg two"></div>
          <div class="robot-arm"></div>
        </div>
        <div class="water-drops"><span></span><span></span><span></span></div>
        <div class="plant-grow"></div>
      </div>
    </div>

    <div class="scene scene-2" data-zone="right">
      <div class="scene-title">Greenhouse Scanner</div>
      <div class="scene-stage">
        <div class="greenhouse-mini"></div>
        <div class="scan-line"></div>
        <div class="sensor-ping"></div>
      </div>
    </div>

    <div class="scene scene-3" data-zone="left">
      <div class="scene-title">Auto Pump Filling Tank</div>
      <div class="scene-stage">
        <div class="pipe-big"></div>
        <div class="pump-wheel"></div>
        <div class="tank"></div>
      </div>
    </div>

    <div class="scene scene-4" data-zone="right">
      <div class="scene-title">Solar Powered</div>
      <div class="scene-stage">
        <div class="solar-panel"></div>
        <div class="sun-orb"></div>
        <div class="power-wave"></div>
      </div>
    </div>

    <div class="scene scene-5" data-zone="top">
      <div class="scene-title">Drone Health Check</div>
      <div class="scene-stage">
        <div class="drone-body"></div>
        <div class="crop-line one"></div>
        <div class="crop-line two"></div>
        <div class="drone-beam"></div>
      </div>
    </div>

    <div class="scene scene-6" data-zone="bottom">
      <div class="scene-title">Fertilizer Robot</div>
      <div class="scene-stage">
        <div class="ferti-robot"></div>
        <div class="sprinkle"><i></i><i></i><i></i><i></i></div>
        <div class="mini-pot"></div>
      </div>
    </div>
  `;
  document.body.prepend(layer);

  const scenes = [...layer.querySelectorAll(".scene")];

  // Use zones so the moving scenes do not always cover the main dashboard content.
  const zones = {
    left:   { xMin: 2,  xMax: 16, yMin: 12, yMax: 76 },
    right:  { xMin: 78, xMax: 88, yMin: 12, yMax: 76 },
    top:    { xMin: 28, xMax: 60, yMin: 5,  yMax: 14 },
    bottom: { xMin: 28, xMax: 60, yMin: 78, yMax: 86 }
  };

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function moveScene(scene, firstMove = false) {
    const zoneName = scene.dataset.zone || "left";
    const zone = zones[zoneName];

    const x = randomBetween(zone.xMin, zone.xMax);
    const y = randomBetween(zone.yMin, zone.yMax);

    if (firstMove) scene.style.transition = "none";
    else scene.style.transition = "left 6.5s cubic-bezier(.22,.61,.36,1), top 6.5s cubic-bezier(.22,.61,.36,1), opacity .6s ease";

    scene.style.left = x + "vw";
    scene.style.top = y + "vh";

    if (firstMove) {
      requestAnimationFrame(() => {
        scene.style.transition = "left 6.5s cubic-bezier(.22,.61,.36,1), top 6.5s cubic-bezier(.22,.61,.36,1), opacity .6s ease";
      });
    }
  }

  scenes.forEach((scene) => moveScene(scene, true));

  // Each 小剧场 moves at a different time, so the background feels alive but not laggy.
  scenes.forEach((scene, index) => {
    const interval = 9500 + index * 1400;
    setInterval(() => moveScene(scene), interval);
  });
}

window.addEventListener("load", createTheaterLayer);
