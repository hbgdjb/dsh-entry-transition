/**
 * `@dsh-skin/harness-skin` — browser half.
 *
 * The transition layer's markup, styles and state machine arrive as host index
 * injections, so this half owns only the *handshake* between that layer and the
 * shell, and it owns its effects so an unload (or HMR) leaves nothing behind:
 *
 * 1. `data-hsx-boot` on `<html>` keeps the shell's own boot placeholder hidden
 *    behind the transition layer. It is released here when the layer is gone —
 *    including the paths where the layer never rendered.
 * 2. If the transition layer is present when the shell's placeholder is removed,
 *    the skin asks the layer to play its exit immediately instead of waiting for
 *    the layer's own poll, which keeps the exit cue tied to real activation.
 *
 * The bundle is served from `lib/client.js` and follows the client module
 * protocol: a factory registered with `window.__ModuleLoader__.load`.
 */

window.__ModuleLoader__.load({
  id: '@dsh-skin/harness-skin',
  factory: (require) => {
    const exports = {};
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const PLUGIN_ID = '@dsh-skin/harness-skin';
    const BOOT_ATTR = 'data-hsx-boot';
    const LAYER_SELECTOR = '[data-hsx-root]';

    /** Style tag ids this half owns, so teardown can find them again. */
    const styleTags = new Set();

    /**
     * Inject one owned stylesheet.
     *
     * @param {string} id - asset id for the `data-plugin-css` attribute.
     * @param {string} css - stylesheet text.
     */
    const injectStyle = (id, css) => {
      if (typeof document === 'undefined') return;
      const tagId = `${PLUGIN_ID}/${id}`;
      const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`);
      if (existing !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
      styleTags.add(tag);
    };

    /** Hand the shell's boot placeholder back to the shell. */
    const releasePlaceholder = () => {
      const root = document.documentElement;
      if (root.dataset.hsxBoot !== undefined) delete root.dataset.hsxBoot;
    };

    /**
     * Ask the transition layer to exit now, and release the placeholder once it
     * is actually gone. Falls back to releasing immediately when no layer exists.
     */
    const dismissLayer = () => {
      const layer = document.querySelector(LAYER_SELECTOR);
      if (layer === null) {
        releasePlaceholder();
        return;
      }
      const finish = () => releasePlaceholder();
      window.addEventListener('hsx:done', finish, { once: true });
      const bridge = window.__HSX__;
      if (bridge !== undefined && typeof bridge.dismiss === 'function') bridge.dismiss();
      else setTimeout(finish, 4000);
    };

    /**
     * @param {import('@deepseek-ai/cordis').Context} ctx - client plugin context.
     */
    const apply = (ctx) => {
      if (typeof document === 'undefined') return;

      ctx.effect(() => () => {
        for (const tag of styleTags) tag.remove();
        styleTags.clear();
        document.documentElement.removeAttribute('data-hsx-skin');
      }, 'harness-skin: owned stylesheets');

      // Marks the skin as owning the palette; theme.css keys its font/geometry
      // tokens off this attribute.
      document.documentElement.setAttribute('data-hsx-skin', '');

      const release = () => {
        const layer = document.querySelector(LAYER_SELECTOR);
        if (layer !== null) dismissLayer();
        else releasePlaceholder();
      };

      /** Watch the shell's placeholder; its removal is the activation signal. */
      const attachObserver = () => {
        if (document.querySelector('[data-dsh-boot]') === null) return;
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-dsh-boot]') === null) {
            observer.disconnect();
            release();
          }
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-dsh-boot'],
        });
        ctx.effect(() => () => observer.disconnect(), 'harness-skin: activation observer');
      };

      if (document.querySelector('[data-dsh-boot]') === null) {
        // No placeholder right now. Give the shell a few frames to mount one
        // before concluding that activation is already finished.
        let frames = 0;
        const probe = () => {
          if (document.querySelector('[data-dsh-boot]') !== null) {
            attachObserver();
            return;
          }
          frames += 1;
          if (frames < 120) requestAnimationFrame(probe);
          else release();
        };
        requestAnimationFrame(probe);
        return;
      }
      attachObserver();
    };

    exports.apply = apply;
    exports.inject = [];
    exports.name = PLUGIN_ID;
    return exports;
  },
});
