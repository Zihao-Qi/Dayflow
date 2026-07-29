/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Chromium only discovers a web app manifest linked from the document head.
  // Dayflow's metadata is static, so keep it in the blocking head response.
  htmlLimitedBots: /.*/
};

export default nextConfig;
