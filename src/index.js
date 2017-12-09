const fs = require('fs');
const url = require('url');
const http = require('http');

const CONFIG_FILENAME = '/config.json';
const TIMEOUT = 10000;
const DATA_FETCH_RETRY_AFTER = 10000;

let multimediaListJson;
let config;
let isDuringProcessing = false;

function download(serverUrl, fileName, outFolder, callback) {

    const fileUrl = serverUrl + '/' + fileName;

    var file = fs.createWriteStream(outFolder + '/' + fileName).on('error', function(error){
        console.log(`ERROR: ${error.message}`);
        return;
    }).on('open', function(){
        console.log('INFO: attempting to download: ' + fileUrl);

        var request = http.get(fileUrl).on('response', function (response) {
            var len = parseInt(response.headers['content-length'], 10);
            var downloaded = 0;
            var lastPercent = 0;
            response.on('data', function (chunk) {
                file.write(chunk);
                downloaded += chunk.length;
                let percent = (100.0 * downloaded / len).toFixed(2);
                if (percent - lastPercent > 10) {
                    lastPercent = percent;
                    console.log(`INFO: downloaded: ${percent}% ${downloaded} bytes`);
                }
                clearTimeout(timeoutId);
                timeoutId = setTimeout(fn, TIMEOUT);
            }).on('end', function () {
                // clear timeout
                clearTimeout(timeoutId);
                file.end();
                console.log(`INFO: file ${fileName} downloaded.`);
                callback(null);
            }).on('error', function (err) {
                // clear timeout
                clearTimeout(timeoutId);
                callback(err.message);
            });
        });

        function timeoutWrapper(req) {
            return function () {
                console.log('ERROR: download timeout');
                req.abort();
                callback('File transfer timeout!');
            };
        };

        // generate timeout handler
        var fn = timeoutWrapper(request);

        // set initial timeout
        var timeoutId = setTimeout(fn, TIMEOUT);
    })

}

function checkAndDownload(serverUrl, fileName, outFolder, completeCallback) {
    fs.access(config.outputFolder + '/' + fileName, function (shouldBeDownloaded) {
        if (shouldBeDownloaded) {
            download(serverUrl, fileName, outFolder, function () {
                console.log('INFO: file ' + fileName + ' downloaded');
                completeCallback(false);
            });
        } else {
            console.log('INFO: file: ' + fileName + ' already exists');
            completeCallback(true);
        }
    });
}

function getMultimedia() {
    if (!multimediaListJson) {
        console.log('ERROR: multimediaListJson is undefined');
        return retryLoadingMultimedia();
    }

    if (!multimediaListJson.hasOwnProperty('multimedia') || !Array.isArray(multimediaListJson.multimedia)) {
        console.log('ERROR: wrong multimedia JSON format');
        return retryLoadingMultimedia();
    }

    if (multimediaListJson.multimedia.length <= 0) {
        console.log('ERROR: multimedia list is empty');
        return retryLoadingMultimedia();
    }

    let currentFileIndex = -1;
    let filesDownloaded = 0;
    let filesSkipped = 0;

    function getNextFile(lastSkipped = true) {
        filesDownloaded += lastSkipped ? 0 : 1;
        filesSkipped += lastSkipped ? 1 : 0;

        currentFileIndex++;
        if (currentFileIndex >= multimediaListJson.multimedia.length) {
            console.log('INFO: multimedia up to date');
            console.log(`INFO: files downloaded: ${filesDownloaded}`);
            console.log(`INFO: files skipped: ${filesSkipped}`);
            isDuringProcessing = false;
            return;
        }
        checkAndDownload(config.multimediaUrl, multimediaListJson.multimedia[currentFileIndex].resource_url, config.outputFolder, getNextFile);
    }

    getNextFile();
}

function loadMultimediaList() {
    if (isDuringProcessing) {
        return;
    }
    isDuringProcessing = true;
    var options = {
        hostname: config.multimediaListHostName,
        port: config.multimediaListPort,
        path: config.multimediaListPath,
        method: 'GET',
        headers: {'Content-Type': 'application/json'}
    };

    var req = http.request(options, function (res) {
        let dataStore = '';
        res.setEncoding('utf8');
        res.on('data', function (data) {
            dataStore += data;
            console.log('INFO: data chunk received');
        });
        res.on('end', function () {
            try {
                console.log('INFO: data download complete. Trying to parse');
                multimediaListJson = JSON.parse(dataStore);

                console.log('INFO: data parsed without exceptions');
                getMultimedia();
            } catch (syntaxError) {
                console.log('ERROR: data parsing problem - ' + syntaxError.message);
                retryLoadingMultimedia();
            }
        });
    });
    req.on('error', function (e) {
        console.log('ERROR: problem with request - ' + e.message);
        retryLoadingMultimedia();
    });
    req.end();
}

function retryLoadingMultimedia() {
    isDuringProcessing = false;
    setTimeout(loadMultimediaList, DATA_FETCH_RETRY_AFTER);
}

function loadConfig() {
    var fs = require('fs');
    fs.readFile(process.cwd() + CONFIG_FILENAME, function (err, data) {
        if (err) {
            console.log(err.message);
        }
        config = JSON.parse(data);
        loadMultimediaList();
        setInterval(loadMultimediaList, config.checkIntervalInMinutes * 60 * 1000);
    });
}

loadConfig();