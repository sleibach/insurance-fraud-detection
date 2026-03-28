sap.ui.define(["sap/base/util/ObjectPath"], function (ObjectPath) {
    "use strict";

    const STRUCTURE_DONE = { structured: 1, predicting: 1, predicted: 1, evaluating: 1, evaluated: 1, reviewed: 1, approved: 1, flagged: 1, rejected: 1, split: 1 };
    const PREDICT_DONE   = { predicted: 1, evaluating: 1, evaluated: 1, reviewed: 1, approved: 1, flagged: 1, rejected: 1, split: 1 };
    const EVALUATE_DONE  = { evaluated: 1, reviewed: 1, approved: 1, flagged: 1, rejected: 1, split: 1 };
    // Positive terminal review outcomes only — flagged/rejected/split handled separately
    const REVIEW_DONE    = { reviewed: 1, approved: 1 };

    function resolve(statusCode, doneMap, activeCode) {
        if (!statusCode) return "None";
        if (statusCode === "failed") return "Error";
        if (doneMap[statusCode]) return "Success";
        if (statusCode === activeCode) return "Warning";
        return "None";
    }

    const formatter = {
        structureState: function (s) { return resolve(s, STRUCTURE_DONE, "structuring"); },
        predictState:   function (s) { return resolve(s, PREDICT_DONE,   "predicting");  },
        evaluateState:  function (s) { return resolve(s, EVALUATE_DONE,  "evaluating");  },
        reviewState: function (s) {
            if (!s)              return "None";
            if (s === "failed")  return "Error";
            if (s === "flagged") return "Error";    // fraud detected — negative outcome
            if (s === "rejected") return "Warning"; // rejected — completed but unfavourable
            if (s === "split")    return "Warning"; // split into sub-claims — special case
            if (REVIEW_DONE[s])  return "Success";
            return "None";
        }
    };

    // Register globally so string-based formatter references resolve via ObjectPath.get()
    ObjectPath.set("claims.ext.formatter.pipeline", formatter);

    return formatter;
});
