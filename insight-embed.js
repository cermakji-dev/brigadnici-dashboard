// Vložení modulu Brigádníci do Insightu – jediný soubor, který Insight potřebuje.
//
// Použití v Insightu (stránka, kde má modul být):
//   <div id="brigadnici"></div>
//   <script type="module">
//     import { mountBrigadnici } from "https://cermakji-dev.github.io/brigadnici-dashboard/insight-embed.js";
//     mountBrigadnici(document.querySelector("#brigadnici"), supabase); // klient Supabase Insightu
//   </script>
//
// Modul nemá vlastní přihlášení. Dostává přístupový token přihlášeného
// uživatele Insightu (stejný projekt Supabase) a podle něj databáze zapisuje
// autora každé změny. Token obnovuje jen Insight; modul ho jen používá.

const MODULE_URL = new URL("./", import.meta.url).href;

export function mountBrigadnici(container, supabaseClient, { height = "100vh" } = {}) {
  const frame = document.createElement("iframe");
  frame.src = MODULE_URL;
  frame.title = "Brigádníci";
  frame.style.cssText = `width:100%;height:${height};border:0;display:block`;
  container.replaceChildren(frame);

  const origin = new URL(MODULE_URL).origin;
  let token = null;
  const send = () => frame.contentWindow?.postMessage({ type: "insight-auth", access_token: token }, origin);

  supabaseClient.auth.getSession().then(({ data }) => { token = data.session?.access_token ?? null; send(); });
  const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, session) => {
    token = session?.access_token ?? null;
    send();
  });
  const onMessage = event => {
    if (event.source === frame.contentWindow && event.data?.type === "brigadnici-ready") send();
  };
  window.addEventListener("message", onMessage);

  return () => {
    subscription.unsubscribe();
    window.removeEventListener("message", onMessage);
    frame.remove();
  };
}
