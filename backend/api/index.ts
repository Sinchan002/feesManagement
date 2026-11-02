import { createApp } from "../src/app"

// Vercel runs the Express app as one serverless function. There is no scheduler here:
// the teacher generates each month's fees from the portal.
export default createApp()
