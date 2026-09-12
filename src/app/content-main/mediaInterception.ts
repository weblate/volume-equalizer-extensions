export type MediaActivity = "playing" | "inactive";

export const attachMediaInterception = (deps: {
  onMedia(target: EventTarget | null, activity: MediaActivity): void;
  onDestinationConnect(
    source: AudioNode,
    destination: AudioDestinationNode,
    connect: (destination: AudioNode) => AudioNode,
  ): AudioNode;
}): (() => void) => {
  const originalConnect = AudioNode.prototype.connect;
  const originalAudio = window.Audio;
  const originalPlay = HTMLMediaElement.prototype.play;
  let disposed = false;

  const connectProxy = new Proxy(originalConnect, {
    apply(target, self, args) {
      const destination = args[0];
      if (destination instanceof AudioDestinationNode) {
        return deps.onDestinationConnect(
          self as AudioNode,
          destination,
          (nextDestination) => Reflect.apply(target, self, [nextDestination]) as AudioNode,
        );
      }
      return Reflect.apply(target, self, args);
    },
  });
  const audioProxy = new Proxy(originalAudio, {
    construct(target, args, newTarget) {
      const media = Reflect.construct(target, args, newTarget) as HTMLAudioElement;
      deps.onMedia(media, "playing");
      return media;
    },
  });
  const playProxy = new Proxy(originalPlay, {
    apply(target, self, args) {
      const media = self as HTMLMediaElement;
      if (!media.isConnected) deps.onMedia(media, "playing");
      return Reflect.apply(target, self, args) as Promise<void>;
    },
  });
  const onPlaying = (event: Event): void => deps.onMedia(event.target, "playing");
  const onInactive = (event: Event): void => deps.onMedia(event.target, "inactive");

  AudioNode.prototype.connect = connectProxy;
  window.Audio = audioProxy;
  HTMLMediaElement.prototype.play = playProxy;
  window.addEventListener("playing", onPlaying, true);
  window.addEventListener("pause", onInactive, true);
  window.addEventListener("ended", onInactive, true);
  document.querySelectorAll("audio, video").forEach((media) => {
    deps.onMedia(media, "playing");
  });

  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("playing", onPlaying, true);
    window.removeEventListener("pause", onInactive, true);
    window.removeEventListener("ended", onInactive, true);
    if (AudioNode.prototype.connect === connectProxy) {
      AudioNode.prototype.connect = originalConnect;
    }
    if (window.Audio === audioProxy) window.Audio = originalAudio;
    if (HTMLMediaElement.prototype.play === playProxy) {
      HTMLMediaElement.prototype.play = originalPlay;
    }
  };
};
