/**
 * Copyright 2017-present, Callstack.
 * All rights reserved.
 *
 * @flow
 */

const webpack = require('webpack');
const path = require('path');
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin');
const haulProgressBar = require('./haulProgressBar');
const AssetResolver = require('../resolvers/AssetResolver');
const HasteResolver = require('../resolvers/HasteResolver');
const moduleResolve = require('../utils/resolveModule');
const getBabelConfig = require('./getBabelConfig');

const PLATFORMS = ['ios', 'android', 'windows'];

type ConfigOptions = {
  root: string,
  dev: boolean,
};

type WebpackPlugin = {
  apply: (typeof webpack) => void,
};

type WebpackConfig = {
  entry: Array<string>,
  output: {
    path: string,
    filename: string,
  },
  plugins: Array<WebpackPlugin>,
};

type WebpackConfigFactory =
  | ((ConfigOptions, WebpackConfig) => WebpackConfig)
  | WebpackConfig;

/**
 * Returns default config based on environment
 */
const getDefaultConfig = ({
  platform,
  root,
  dev,
  minify,
  bundle,
  port,
}): WebpackConfig => {
  process.env.NODE_ENV = dev ? 'development' : 'production';

  // Getting Minor version
  const platformProgressBar = haulProgressBar(platform);
  return {
    context: root,
    entry: [
      /**
       * Polyfills we include for latest JS features
       * It is also needed to setup the required environment
       */
      require.resolve('./polyfillEnvironment.js'),
    ],
    devtool: bundle ? 'source-map' : 'eval-source-map',
    output: {
      path: path.join(root, 'dist'),
      filename: `index.${platform}.bundle`,
      publicPath: `http://localhost:${port}/`,
    },
    module: {
      rules: [
        { parser: { requireEnsure: false } },
        {
          test: /\.js$/,
          exclude: /node_modules\/(?!react|@expo|pretty-format|haul)/,
          use: [
            {
              loader: require.resolve('thread-loader'),
            },
            {
              loader: require.resolve('babel-loader'),
              options: Object.assign({}, getBabelConfig(root), {
                /**
                 * to improve the rebuild speeds
                 * This enables caching results in ./node_modules/.cache/babel-loader/
                 * This is a feature of `babel-loader` and not babel
                 */
                cacheDirectory: dev,
              }),
            },
          ],
        },
        {
          test: AssetResolver.test,
          use: {
            /**
             * Asset loader enables asset management based on image scale
             * This needs the AssetResolver plugin in resolver.plugins to work
             */
            loader: require.resolve('../loaders/assetLoader'),
            query: { platform, root, bundle },
          },
        },
      ],
    },
    plugins: [
      /**
       * MacOS has a case insensitive filesystem
       * This is needed so we can error on incorrect case
       */
      new CaseSensitivePathsPlugin(),

      new webpack.ProgressPlugin(perc => {
        platformProgressBar(platform, perc);
      }),

      new webpack.DefinePlugin({
        /**
         * Various libraries like React rely on `process.env.NODE_ENV`
         * to distinguish between production and development
         */
        'process.env': {
          NODE_ENV: dev ? '"development"' : '"production"',
          DEV_SERVER_ORIGIN: JSON.stringify(`http://localhost:${port}`),
        },
        __DEV__: dev,
      }),
      new webpack.LoaderOptionsPlugin({
        minimize: !!minify,
        debug: dev,
      }),
      /**
       * By default, sourcemaps are only generated with *.js files
       * We need to use the plugin to configure *.bundle to emit sourcemap
       */
      new webpack.SourceMapDevToolPlugin({
        test: /\.(js|css|bundle)($|\?)/i,
        filename: '[file].map',
      }),
    ]
      .concat(
        dev
          ? [
              new webpack.HotModuleReplacementPlugin(),
              new webpack.NamedModulesPlugin(),
            ]
          : new webpack.optimize.ModuleConcatenationPlugin()
      )
      .concat(
        minify
          ? [
              new webpack.optimize.UglifyJsPlugin({
                /**
                 * By default, uglify only minifies *.js files
                 * We need to use the plugin to configutr *.bundle to get minified
                 * Also disable IE8 support as we don't need it'
                 */
                test: /\.(js|bundle)($|\?)/i,
                sourceMap: true,
                compress: {
                  screw_ie8: true,
                  warnings: false,
                },
                mangle: {
                  screw_ie8: true,
                },
                output: {
                  comments: false,
                  screw_ie8: true,
                },
              }),
            ]
          : []
      ),
    resolve: {
      plugins: [
        /**
         * React Native uses a module system called Haste
         * We don't support it, but need to provide a compatibility layer
         */
        new HasteResolver({
          directories: [moduleResolve(root, 'react-native')],
        }),
        /**
         * This is required by asset loader to resolve extra scales
         * It will resolve assets like image@1x.png when image.png is not present
         */
        new AssetResolver({ platform }),
      ],
      /**
       * Match what React Native packager supports
       * First entry takes precendece
       */
      mainFields: ['react-native', 'browser', 'main'],
      extensions: [`.${platform}.js`, '.native.js', '.js'],
    },
    /**
     * Set target to webworker as it's closer to RN environment than `web`.
     */
    target: 'webworker',
  };
};

/**
 * Creates an array of configs based on changing `env` for every
 * platform and returns
 */
function makeReactNativeConfig(
  userWebpackConfig: WebpackConfigFactory,
  options: ConfigOptions
): [Array<WebpackConfig>, typeof PLATFORMS] {
  const configs = PLATFORMS.map(platform => {
    const env = Object.assign({}, options, { platform });
    const defaultWebpackConfig = getDefaultConfig(env);

    const config = Object.assign(
      {},
      defaultWebpackConfig,
      typeof userWebpackConfig === 'function'
        ? userWebpackConfig(env, defaultWebpackConfig)
        : userWebpackConfig
    );

    // For simplicity, we don't require users to extend
    // default config.entry but do it for them.
    config.entry = defaultWebpackConfig.entry.concat(config.entry);

    return config;
  });

  return [configs, PLATFORMS];
}

module.exports = makeReactNativeConfig;
