var databaseUrl = "mongodb://localhost/citibike"; // "username:password@example.com/mydb"
var collections = ["trips", "routes"]
var db = require("mongojs")(databaseUrl, collections);
var http = require('http');

exports.findRoutes = function(params) {
    findUniqueTrips( function(trips) {
        lookupRoutes(trips);
    });
}

function findUniqueTrips(callback) {
    //TODO: This aggregate statement seems odd, should be able to just output lat/long fields after finding 2 unique station id fields
    db.trips.aggregate( [ 
    	{ $group: 
    		{ _id: { start: "$start_station_id" , end: "$end_station_id" },
    		  start_station_id : { $first : "$start_station_id"},
    		  end_station_id : { $first : "$end_station_id"},
    		  start_station_latitude: { $first : "$start_station_latitude" },
    		  start_station_longitude: { $first : "$start_station_longitude" },
         	  end_station_latitude: { $first : "$end_station_latitude" },
    	      end_station_longitude: { $first : "$end_station_longitude" },
    		}
    	}
    ], function(err, trips) {
        if (err) {
            console.error("ERROR FINDING ROUTES: " , err);
        }
        else {
            callback(trips);
        }
    });
}

function lookupRoutes(trips) {
  console.log("found this many unique trips: ", trips.length);
  var i = 0;
  var len = trips.length;
  var numNewRoutes = 0;
  
  for (var i = 0; i < len; ++i) {
      var aTrip = trips[i];
      (function(trip) {
          db.routes.find( { '_id': trip['start_station_id'] + '_' + trip['end_station_id']}, function(err, routes) {
            if (err) {
                console.error("Error looking up trip in routes: ", err);
            }
            if (routes.length === 0) {
                lookupRouteForTrip(trip, numNewRoutes);
                ++numNewRoutes;
            }
          });
      })(aTrip);
  }
}

function lookupRouteForTrip(aTrip, routeNum) {
    var path = "http://maps.googleapis.com/maps/api/directions/json?origin=" + aTrip["start_station_latitude"] + "," + aTrip["start_station_longitude"] +
          "&destination=" + aTrip["end_station_latitude"] + "," + aTrip["end_station_longitude"] +
          "&mode=bicycling";
    setTimeout(function() { lookupOnGoogle(path, aTrip) }, 500*routeNum);
}

function lookupOnGoogle(path, aTrip) {
    http.get(path, function(response) { handleGoogleResponse(response, aTrip); });
}

function handleGoogleResponse(response, aTrip) {
    var body = '';

    response.on('data', function(d) {
      body += d;
    });
    
    response.on('error', function(e) {
      console.error("Error on google map request: ", e);
    });
    
    response.on('end', function() { processBikeTripResponse(body, aTrip); });
}

function  processBikeTripResponse(body, aTrip) {
    var parsed = JSON.parse(body);
    //TODO: Send message to client about progress every so often (10 trips?)
    if (parsed.error_message){
      console.error("Error in google response: ", parsed.error_message); 
    }
    else {
      setCoordinatesAndDistance(parsed, aTrip);
    }
    
    ([{$group:{"start_station_id": "$start_station_id", "end_station_id": "$end_station_id"}}])
    
}

function setCoordinatesAndDistance(directionResult, trip) {
  // For each step, save the coordinates to build a line that follows
  // the default bicycling directions
  // console.log("directionResult: ", directionResult);
  var myRoute = directionResult.routes[0].legs[0];

  trip.coordinates = [];
  trip.distance    = myRoute.distance.value;

  for (var i = 0; i < myRoute.steps.length; i++) {
    var step = myRoute.steps[i];
    trip.coordinates.push(step.start_location);
    if (i === myRoute.steps.length - 1) {
      trip.coordinates.push(step.end_location);
    }
  };
  
  // console.log("saving this trip? ", trip);
  db.trips.save(trip);
  db.routes.save( { '_id'                : trip['start_station_id'] + '_' + trip['end_station_id'],
                    'start station name' : trip['start station name'],
                    'start station id'   : trip['start_station_id'],
                    'end station name'   : trip['end station name'],
                    'end station id'     : trip['end_station_id'],
                    'coordinates'        : trip.coordinates,
                    'distance'           : trip.distance,
                    'duration'           : myRoute.duration.value });
}