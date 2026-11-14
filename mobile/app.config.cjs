module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    package: process.env.SPOTAPLE_ANDROID_PRODUCTION === '1' ? 'com.alexis.spotaple' : config.android.package,
  },
});
