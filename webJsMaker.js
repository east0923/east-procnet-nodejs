/*
* 如果没有对本插件进行修改，可直接使用demo/webClientWs.js，不必自行构建生成。
* 本脚使用webpack构建前端可引入的js脚本，可以使用node直接运行。
*
* 说明文档：demo/readme.md
* 输出路径：demo/webClientWs.js
* 演示页面：demo/index.html （需修改配置）
*
* */

const webpack=require('webpack');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');
const path   =require('path');

const config = {
    //mode: 'development',
    entry: {
        webClientWs: path.resolve(__dirname,'c_clientWs.js'),
    },
    context:path.resolve(__dirname),
    module: {
        rules: [
            {
                loader: 'babel-loader',
                test: /\.js$/,
                exclude:/\/node_modules\//,
                options: {
                    plugins: ['transform-runtime'],
                }
            },
            {
                loader: 'url-loader',
                test: /\.proto$/,
                exclude:'/node_modules/',
            }
        ]
    },
    output: {
        path: path.resolve(__dirname,'dist-static/js/'),
        filename: '[name].js'
    },
    optimization:{
        minimizer:[
            new UglifyJsPlugin({
                uglifyOptions: {
                    compress: {
                        warnings: false
                    }
                },
                sourceMap: true,
                parallel: true
            })
        ]
    }
};

webpack(config, (err, stats) => {
    if (err) throw err

    process.stdout.write(stats.toString({
        colors: true,
        modules: false,
        children: false, // If you are using ts-loader, setting this to true will make TypeScript errors show up during build.
        chunks: false,
        chunkModules: false
    }) + '\n\n')

    if (stats.hasErrors()) {
        console.log('  Build failed with errors.\n')
        process.exit(1)
    }

    console.log('  Build complete.\n')
})
