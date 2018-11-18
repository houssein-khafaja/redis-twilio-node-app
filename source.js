/* 
    This little project is a Twilio-Node.js app that keeps track of a movie to-do list stored on a redis DB hosted by Redis Labs. It also takes advantage of the
    IMDB database. When this code is copy-pasted into my Twilio function, it will intercept mobile text messages and respond to the user.

    Note: Twilio is an SMS FaaS provider which lets our code work with text messages. This code will not work in an environment outside Twilio (although, anything is possible).

    This app is already live on twilio, you only need to text: 1 289 768 8362.
*/
var imdb = require('imdb-api');
var redis = require("redis");
var rs = require("redisscan");

// temp object to be used outside Twillio
var event = {
    ...
};

// set up our api clients
var redisClient = redis.createClient(18804, "redis-xxxxxxxx.redislabs.com", { "password": "XXXXXXXXXXXXXXX" });
let twiml = new Twilio.twiml.MessagingResponse();
const imdbClient = new imdb.Client({ apiKey: '...' });

// redist event listeners
redisClient.on("error", function(err)
{
    console.log("Error " + err);
});

redisClient.on("connect", function()
{
    console.log("REDIS labs connected");
});

var command = event.Body.split(" ")[0];
var param = event.Body.replace(command, "").trim(); // remove the command string from the rest of the event body

// execute function based on parsed command
switch (command.toLocaleLowerCase())
{
    case "add":
        addMovie(param);
        break;

    case "list":
        listMovies("");
        break;

    case "lbg":
        listMovies(param.trim());
        break;

    case "modify":
        modify(param.trim());
        break;

    case "del":
        remove(param.trim());
        break;

    case "search":
        search(param.trim());
        break;

    case "clear":
        clearList();
        break;

    case "bothelp":
        help(param.trim());
        break;

    default:
        respondBack("Invalid command. Use the 'bothelp' command to get help.");
        break;
}

// 1) use imdb api to see if movie exists
// 2) if it does, add it to the watch-list
function addMovie(movieName)
{
    imdbClient.get({ 'name': movieName }).then((result) =>
        {
            console.log("get movie starts");

            var data = {
                title: result.title,
                genres: result.genres,
                year: result._year_data,
                rating: result.rating,
                isWatched: false
            };

            redisAddOrModify(data);

        })
        .catch(err =>
        {
            // Failure
            console.log(err);
            respondBack(err.message);
        });
}

// use redis-scan to scan entire db to get all keys and values from redis
// then use the genre filter to only return movies that have the genre
function listMovies(genreFilter)
{
    var movies = [];

    // scan redis
    rs(
    {
        redis: redisClient,
        keys_only: false,
        pattern: "**",
        each_callback: function(type, key, subkey, length, value, cb)
        {
            var movieObject = JSON.parse(value);
            
            // split genres string into an array of strings, then trim and lowercase each string
            var genres = movieObject.genres.split(", ").map(x => x.trim().toLocaleLowerCase());

            // only return the movie if there is no filter or if the movie has the genre
            if (genres.includes(genreFilter.toLocaleLowerCase()) || genreFilter === "")
            {
                movies.push(movieObject);
            }

            cb(); // next
        },
        done_callback: function(err)
        {
            if (genreFilter !== "" && movies.length === 0)
            {
                respondBack("No movies with that genre is in the list.");
            }
            else
            {
                var message = "";

                // build message - tack on each movie found from scan
                movies.forEach(movie =>
                {
                    message += `\n\n${movie.title} (${movie.year})\n    Genres: ${movie.genres}\n    Rating: ${movie.rating}/10\n    Watched: ${movie.isWatched}`;
                    console.log(message);
                });

                if (movies.length == 0)
                {
                    message = "Your list is empty";
                }

                respondBack(message);
            }
        }
    });
}

// this will check or uncheck the "isWatched" variable on a specific movie
// the redis keys are the movie names.
function modify(movieName)
{
    var movieIsFound = false;

    // scan for the movie
    rs(
    {
        redis: redisClient,
        pattern: movieName.toLocaleLowerCase(),
        keys_only: false,
        each_callback: function(type, key, subkey, length, value, cb)
        {
            movieIsFound = true;

            var movieObject = JSON.parse(value);
            movieObject.isWatched = !movieObject.isWatched;
            redisAddOrModify(movieObject);

            cb(); // next
        },
        done_callback: function(err)
        {
            if (!movieIsFound)
            {
                respondBack("Movie you tried to modify was not found.");
            }
        }
    });
}

// removes the specified movie from the redis DB
function remove(movieName)
{
    console.log(movieName);

    var movieIsFound = false;

    rs(
    {
        redis: redisClient,
        pattern: movieName.toLocaleLowerCase(),
        keys_only: true,
        each_callback: function(type, key, subkey, length, value, cb)
        {
            movieIsFound = true;
            redisClient.del(key);
            respondBack(`${key} was deleted.`);
            cb(); // next
        },
        done_callback: function(err)
        {
            if (!movieIsFound)
            {
                respondBack("Movie you tried to delete was not found.");
            }
        }
    });
}

// looks for a movie in the specified DB
function search(movieName)
{
    imdbClient.search({ 'name': movieName }).then((search) =>
        {
            var message = "Results: \n\n";

            for (const movie of search.results)
            {
                console.log(movie);

                message += `\n\n${movie.title} (${movie.year})`;
            }

            respondBack(message);
        })
        .catch(err =>
        {
            // Failure
            console.log(err);
            // respondBack(err.message);
        });
}

// clear the entire redis DB
function clearList()
{
    redisClient.flushall((err, result) =>
    {
        if (err)
        {
            respondBack("An error occurred while clearing the list.");
        }
        else
        {
            respondBack((result === "OK") ? "List cleared" : `Server responded with: ${result}`);
        }
    });
}

// a basic function that ends the redis client (because the twillio function is about to close) and returns a message to whoever texted the Twillio number
function respondBack(message)
{
    twiml.message(message);
    redisClient.quit();
    callback(null, twiml);
}

// multi-purpose function to add a redis record, or modify it if it already exists
function redisAddOrModify(movieObject)
{
    redisClient.set(movieObject.title.toLocaleLowerCase(), JSON.stringify(movieObject), function(err, reply)
    {
        if (!err)
        {
            respondBack(`${movieObject.title} was added/modified.`);
        }
        else
        {
            // handle error here
        }
    });
}

// if help command is used without any params, return a list of commands, otherwise send back a description of a specified command
function help(param)
{
    var message = "\n\n\n";

    switch (param)
    {
        case "":
            message +=
                `-Add [movieName]\n
-List\n
-List By Genre (lbg [genre])\n
-Modify [movieName]\n
-Del [movieName]\n
-Search [query param]\n
-Clear\n
-bothelp [command]\n`;
            break;

        case "add":
            message += `Add [movieName]: Adds a movie to the watch-list. E.g. "add batman"`;
            break;

        case "list":
            message += `List: Single-word command that returns a list of all the movies in the watch-list. E.g. "list"`;
            break;

        case "lbg":
            message += `List By Genre (lbg [genre]): Returns a list of all movies that contain the specefied genre. E.g. "lbg romance"`;
            break;

        case "modify":
            message += `Modify [movieName]: Checks or unchecks the Watched value of a specefied movie. E.g. "modify batman"`;
            break;

        case "del":
            message += `Del [movieName]: Removes the specefied movie from the watch-list. E.g. "del batman"`;
            break;

        case "search":
            message += `Search [query param]: Queries the imdb database with the specified movie name and returns the list of results. E.g. "search batman"`;
            break;

        case "clear":
            message += `Clear: Clears the watch-list. E.g. "clear"`;
            break;

        case "bothelp":
            message += `bothelp [command]: Returns a list of all commands, or a specific command and its description if provided with one. E.g. "bothelp" or "bothelp bothelp"`;
            break;

        default:
            message += `Command was not found. For a list of commands, simply send "bothelp"`;
            break;
    }

    respondBack(message);
}
