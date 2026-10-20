const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  entry: './src/index.jsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'auto',
    clean: true,
    uniqueName: 'eia_payment'
  },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'ecmascript', jsx: true },
              transform: { react: { runtime: 'automatic' } }
            }
          }
        }
      },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ]
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'eia_payment',
      filename: 'remoteEntry.js',
      exposes: { './App': './src/App.jsx' },
      shared: {
        react: { singleton: true, requiredVersion: false },
        'react-dom': { singleton: true, requiredVersion: false }
      }
    }),
    new HtmlWebpackPlugin({ template: './public/index.html' })
  ],
  devServer: {
    port: 3009,
    historyApiFallback: true,
    hot: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:8098',
        changeOrigin: true
      }
    ]
  }
};
