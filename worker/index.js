import appHtml from "./app.html";
import reviewCss from "./review.css";
import { createApp } from "./lib.js";

const app = createApp({
  appHtml,
  reviewCss,
  // bookingUrl: a scheduling link for the Schedule button on a phone; blank hides it.
  advisor: { name: "Alex Singer", phone: "248-942-4743", bookingUrl: "" },
});

export default app;
