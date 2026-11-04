/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.DOCKER_BUILD === "1" && {
    output: "standalone",
  }),
};

module.exports = nextConfig;
