// Smart Green House System BGM
// Full BGM design:
// 1. BGM continues when changing pages.
// 2. First website load chooses a random song.
// 3. When one song ends, it automatically changes to another random song.
// 4. Mute button pauses/resumes the same song without reset.
// 5. BGM only runs in the parent page to prevent duplicate music.

if (window.self !== window.top) {
  console.log("BGM is controlled by the parent page only.");

  function retryParentBgm() {
    try {
      if (window.top && typeof window.top.__sghsStartBgm === "function") {
        window.top.__sghsStartBgm(false);
      }
    } catch (error) {}
  }

  window.addEventListener("pointerdown", retryParentBgm, { once: true });
  window.addEventListener("keydown", retryParentBgm, { once: true });
} else {
  const BGM_MUTED_KEY = "GREENHOUSE_BGM_MUTED";
  const BGM_LAST_KEY = "GREENHOUSE_LAST_BGM";
  const BGM_CURRENT_KEY = "GREENHOUSE_CURRENT_BGM";

  let player = null;
  let playerReady = false;
  let apiReady = false;
  let apiLoading = false;
  let bgmStarted = false;
  let currentVideoId = "";
  let pendingVideoId = "";
  let userInteracted = false;

  // Random YouTube BGM list
  // Only put YouTube video ID here, not full link.
  const BGM_LIST = [
    "0HAAOoPWKWM",
    "rvAtfKiEzXU",
    "cYD8TEUtgto",
    "8VLXHyHRXjc",
    "O4zyPTo925A",
    "3szY1OSTYyQ",
    "Es7hLsV0QkU",
    "XMEQO6kpYPA",
    "rpdvUlEsodc",
    "NDEWXnMRq3c",
    "FGGo8LFmbjs",
    "xQBVQBMuaec",
    "d-2uDCSS07I",
    "liTfD88dbCo",
    "bbdsIR4UHDg",
    "W0DM5lcj6mw",
    "r9ocxIygXWo",
    "H78YW7ycuwI",
    "oS07d8Gr4tw"
  ];

  function ensureSpeakerButton() {
    if (document.getElementById("speakerToggleBtn")) return;

    const btn = document.createElement("button");
    btn.id = "speakerToggleBtn";
    btn.className = "speaker-btn";
    btn.type = "button";
    btn.title = "Pause / Resume BGM";
    btn.onclick = toggleBgmMute;
    document.body.appendChild(btn);

    updateSpeakerIcon();
  }

  function ensurePlayerBox() {
    if (document.getElementById("bgmPlayerBox")) return;

    const box = document.createElement("div");
    box.id = "bgmPlayerBox";
    box.style.position = "fixed";
    box.style.width = "1px";
    box.style.height = "1px";
    box.style.left = "-300px";
    box.style.top = "-300px";
    box.style.opacity = "0";
    box.style.pointerEvents = "none";
    box.style.overflow = "hidden";
    document.body.appendChild(box);
  }

  function isBgmMuted() {
    return localStorage.getItem(BGM_MUTED_KEY) === "1";
  }

  function updateSpeakerIcon() {
    const btn = document.getElementById("speakerToggleBtn");
    if (!btn) return;
    btn.textContent = isBgmMuted() ? "🔇" : "🔊";
  }

  function chooseRandomVideoId() {
    if (BGM_LIST.length === 0) return "";
    if (BGM_LIST.length === 1) return BGM_LIST[0];

    const lastVideo = localStorage.getItem(BGM_LAST_KEY);
    const currentVideo = currentVideoId || localStorage.getItem(BGM_CURRENT_KEY);

    let selectedVideo = BGM_LIST[Math.floor(Math.random() * BGM_LIST.length)];

    // Avoid repeating the same current/previous song.
    let retry = 0;
    while (
      (selectedVideo === lastVideo || selectedVideo === currentVideo) &&
      retry < 30
    ) {
      selectedVideo = BGM_LIST[Math.floor(Math.random() * BGM_LIST.length)];
      retry++;
    }

    localStorage.setItem(BGM_LAST_KEY, selectedVideo);
    localStorage.setItem(BGM_CURRENT_KEY, selectedVideo);
    currentVideoId = selectedVideo;

    return selectedVideo;
  }

  function loadYouTubeAPI() {
    if (apiReady || (window.YT && window.YT.Player)) {
      apiReady = true;
      return Promise.resolve();
    }

    if (apiLoading) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (apiReady || (window.YT && window.YT.Player)) {
            clearInterval(check);
            apiReady = true;
            resolve();
          }
        }, 100);
      });
    }

    apiLoading = true;

    return new Promise((resolve) => {
      const previousCallback = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = function () {
        apiReady = true;

        if (typeof previousCallback === "function") {
          previousCallback();
        }

        resolve();
      };

      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
  }

  function createPlayer(videoId) {
    ensurePlayerBox();

    pendingVideoId = videoId;

    player = new YT.Player("bgmPlayerBox", {
      width: "1",
      height: "1",
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  }

  function onPlayerReady(event) {
    playerReady = true;

    if (isBgmMuted()) {
      pauseBgm(false);
      updateSpeakerIcon();
      return;
    }

    try {
      event.target.setVolume(70);
      event.target.playVideo();
      bgmStarted = true;
    } catch (error) {
      console.log("BGM autoplay waiting for user interaction.");
    }

    updateSpeakerIcon();
  }

  function onPlayerStateChange(event) {
    if (!window.YT || !window.YT.PlayerState) return;

    // 0 = ENDED
    if (event.data === window.YT.PlayerState.ENDED) {
      console.log("BGM ended. Changing to next random song.");

      if (!isBgmMuted()) {
        playNextRandomBgm();
      }
    }
  }

  function onPlayerError(event) {
    console.log("BGM player error:", event.data);
    // If one video cannot play/embed, skip to another random one.
    if (!isBgmMuted()) {
      setTimeout(playNextRandomBgm, 700);
    }
  }

  async function startBgm(forceNew = false) {
    ensureSpeakerButton();
    ensurePlayerBox();

    if (isBgmMuted()) {
      pauseBgm(false);
      updateSpeakerIcon();
      return;
    }

    await loadYouTubeAPI();

    const selectedVideo = forceNew
      ? chooseRandomVideoId()
      : (currentVideoId || localStorage.getItem(BGM_CURRENT_KEY) || chooseRandomVideoId());

    if (!selectedVideo) {
      console.log("No BGM video ID found.");
      return;
    }

    currentVideoId = selectedVideo;

    if (!player) {
      createPlayer(selectedVideo);
      bgmStarted = true;
      console.log("BGM selected:", selectedVideo);
      return;
    }

    if (forceNew) {
      player.loadVideoById(selectedVideo);
      bgmStarted = true;
      console.log("New random BGM selected:", selectedVideo);
      return;
    }

    // Resume same song. Do not reload/reset it.
    try {
      player.playVideo();
      bgmStarted = true;
    } catch (error) {
      console.log("BGM resume waiting for user interaction.");
    }

    updateSpeakerIcon();
  }

  // Pause only. Do not destroy player. This prevents reset.
  function pauseBgm(update = true) {
    try {
      if (player && player.pauseVideo) {
        player.pauseVideo();
      }
    } catch (error) {}

    if (update) {
      updateSpeakerIcon();
    }
  }

  // Full stop/reset function for console testing only.
  function stopBgm(update = true) {
    try {
      if (player && player.stopVideo) {
        player.stopVideo();
      }
    } catch (error) {}

    bgmStarted = false;

    if (update) {
      updateSpeakerIcon();
    }
  }

  function toggleBgmMute() {
    if (isBgmMuted()) {
      localStorage.setItem(BGM_MUTED_KEY, "0");
      startBgm(false); // Resume same song, no random reset.
    } else {
      localStorage.setItem(BGM_MUTED_KEY, "1");
      pauseBgm(); // Pause same song, no reset.
    }

    updateSpeakerIcon();
  }

  function playNextRandomBgm() {
    localStorage.setItem(BGM_MUTED_KEY, "0");

    const nextVideo = chooseRandomVideoId();

    if (!nextVideo) return;

    if (player && playerReady) {
      player.loadVideoById(nextVideo);
      bgmStarted = true;
      console.log("Auto next random BGM:", nextVideo);
    } else {
      startBgm(true);
    }

    updateSpeakerIcon();
  }

  // Console testing:
  // nextRandomBgm() = manually change to another random song.
  // pauseBgm() = pause current song.
  // startBgm(false) = resume current song.
  window.nextRandomBgm = playNextRandomBgm;
  window.pauseBgm = pauseBgm;
  window.stopBgm = stopBgm;
  window.startBgm = startBgm;

  // Parent functions used by pages inside iframe.
  window.__sghsStartBgm = startBgm;
  window.__sghsStopBgm = stopBgm;
  window.__sghsToggleBgmMute = toggleBgmMute;

  window.addEventListener("load", () => {
    ensureSpeakerButton();

    // Random once when website first opens.
    startBgm(true);

    // Browser may block autoplay before user interaction.
    // First click/keyboard action will retry playing the same current song.
    const retry = () => {
      userInteracted = true;
      startBgm(false);
    };

    window.addEventListener("pointerdown", retry, { once: true });
    window.addEventListener("keydown", retry, { once: true });
  });
}
