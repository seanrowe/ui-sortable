/*
 jQuery UI Sortable plugin wrapper

 @param [ui-sortable] {object} Options to pass to $.fn.sortable() merged onto ui.config
 */
(function (module) {
    "use strict";

    var uiSortableConfig,
        timeout,
        log,
        directiveOpts = {
            "ui-floating": undefined,
            "ui-model-items": undefined
        };

    /**
     * Return the index of ui.item among the items we can't just do ui.item.index()
     * because there it might have siblings which are not items
     * 
     * @param {angular.IAugmentedJQuery} item
     * @return {number}
     */
    var getItemIndex = function (item) {
        return item.parent()
            .find(opts["ui-model-items"])
            .index(item);
    };

    /**
     * getSortableWidgetInstance
     * @param {angular.IAugmentedJQuery} element
     * @return Object || null
     */
    var getSortableWidgetInstance = function (element) {
        // this is a fix to support jquery-ui prior to v1.11.x
        // otherwise we should be using `element.sortable('instance')`
        var data = element.data("ui-sortable");

        if (data && typeof data === "object" && data.widgetFullName === "ui-sortable") {
            return data;
        }

        return null;
    };

    var Wrappers = (function () {

        /**
         * wrappers constructor
         * @param {angular.INgModelController} model
         * @param {angular.IAugmentedJQuery} element
         */
        var wrappers = function(model, element) {
            this.helper = null;
            this.model = model;
            this.element = element;
        };

        wrappers.prototype.helper = function(inner) {
            var self = this;

            if (inner && typeof inner === "function") {
                return function(e, item) {
                    var oldItemSortable = item.sortable,
                        index = getItemIndex(item),
                        innerResult;

                    item.sortable = {
                        model: self.model.$modelValue[index],
                        index: index,
                        source: self.element,
                        sourceList: item.parent(),
                        sourceModel: self.model.$modelValue,
                        _restore: function() {
                            angular.forEach(item.sortable,
                                function(value, key) {
                                    item.sortable[key] = undefined;
                                });

                            item.sortable = oldItemSortable;
                        }
                    };

                    innerResult = inner.apply(this, arguments);
                    item.sortable._restore();
                    item.sortable._isCustomHelperUsed = item !== innerResult;
                    return innerResult;
                };
            }

            return inner;
        };

        return wrappers;
    })();

    var Callbacks = (function () {

        /**
         * Exact match with the placeholder's class attribute to handle the
         * case that multiple connected sortables exist and the placeholder
         * option equals the class of sortable items
         * 
         * @param {angular.IAugmentedJQuery} element
         * @param {angular.IAugmentedJQuery} placeholder
         * @param {any} opts
         * @return JQuery
         */
        var getPlaceholderExcludes = function (element, placeholder, opts) {
            var notCssSelector = opts["ui-model-items"].replace(/[^,]*>/g, "");
            return element.find('[class="' + placeholder.attr("class") + '"]:not(' + notCssSelector + ")");
        };

        /**
         * getPlaceholderElement
         * @param {angular.IAugmentedJQuery} element
         * @return {any} || null
         */
        var getPlaceholderElement = function (element) {
            var placeholder = element.sortable("option", "placeholder");
            var result = null;

            // placeholder.element will be a function if the placeholder, has
            // been created (placeholder will be an object).  If it hasn't
            // been created, either placeholder will be false if no
            // placeholder class was given or placeholder.element will be
            // undefined if a class was given (placeholder will be a string)
            if (placeholder && placeholder.element && typeof placeholder.element === "function") {
                result = placeholder.element();

                // workaround for jquery ui 1.9.x,
                // not returning jquery collection
                result = angular.element(result);
            }

            return result;
        };

        /**
         * callbacks constructor
         * @param {any} opts
         * @param {angular.INgModelController} model
         * @param {angular.IAugmentedJQuery} element
         * @param {angular.IScope} scope
         */
        var callbacks = function(opts, model, element, scope) {
            this.receive = null;
            this.remove = null;
            this.start = null;
            this.stop = null;
            this.update = null;
            this.savedNodes = null;
            this.opts = opts;
            this.model = model;
            this.element = element;
            this.scope = scope;
        };

        /**
         * start
         * @param e
         * @param ui
         */
        callbacks.prototype.start = function(e, ui) {
            var self = this,
                index;

            // since the drag has started, the element will be
            // absolutely positioned, so we check its siblings
            if (self.opts["ui-floating"] === "auto") {
                getSortableWidgetInstance(angular.element(e.target)).floating = isFloating(ui.item.siblings());
            }

            // Save the starting position of dragged item
            index = getItemIndex(ui.item);

            ui.item.sortable = {
                model: self.model.$modelValue[index],
                index: index,
                source: self.element,
                sourceList: ui.item.parent(),
                sourceModel: self.model.$modelValue,
                _isCanceled: false,
                _isCustomHelperUsed: ui.item.sortable._isCustomHelperUsed,
                _connectedSortables: [],
                cancel: function() {
                    ui.item.sortable._isCanceled = true;
                },
                isCanceled: function() {
                    return ui.item.sortable._isCanceled;
                },
                isCustomHelperUsed: function() {
                    return !!ui.item.sortable._isCustomHelperUsed;
                },
                _destroy: function() {
                    angular.forEach(ui.item.sortable,
                        function(value, key) {
                            ui.item.sortable[key] = undefined;
                        });
                },
                _getElementContext: function(element) {
                    return getElementContext(this._connectedSortables, element);
                }
            };
        };

        /**
         * activate
         * @param e
         * @param ui
         */
        callbacks.prototype.activate = function(e, ui) {
            var self = this,
                placeholder,
                excludes,
                isSourceContext = ui.item.sortable.source === self.element,
                savedNodesOrigin = isSourceContext ? ui.item.sortable.sourceList : self.element;

            // save the directive's scope so that it is accessible from ui.item.sortable
            ui.item.sortable._connectedSortables.push({
                element: self.element,
                scope: self.scope,
                isSourceContext: isSourceContext,
                savedNodesOrigin: savedNodesOrigin
            });

            // We need to make a copy of the current element's contents so
            // we can restore it after sortable has messed it up.
            // This is inside activate (instead of start) in order to save
            // both lists when dragging between connected lists.
            self.savedNodes = savedNodesOrigin.contents();

            // If this list has a placeholder (the connected lists won't),
            // don't include it in saved nodes.
            placeholder = getPlaceholderElement(self.element);

            if (placeholder && placeholder.length) {
                excludes = getPlaceholderExcludes(self.element, placeholder);
                self.savedNodes = savedNodes.not(excludes);
            }
        };

        /**
         * update
         * @param e
         * @param ui
         */
        callbacks.prototype.update = function(e, ui) {
            var self = this,
                droptarget,
                droptargetContext,
                sortingHelper,
                elementContext;

            // Save current drop position but only if this is not a second
            // update that happens when moving between lists because then
            // the value will be overwritten with the old value
            if (!ui.item.sortable.received) {
                ui.item.sortable.dropindex = getItemIndex(ui.item);
                droptarget = ui.item.closest("[ui-sortable], [data-ui-sortable], [x-ui-sortable]");
                ui.item.sortable.droptarget = droptarget;
                ui.item.sortable.droptargetList = ui.item.parent();
                droptargetContext = ui.item.sortable._getElementContext(droptarget);
                ui.item.sortable.droptargetModel = droptargetContext.scope.ngModel;

                // Cancel the sort (let ng-repeat do the sort for us)
                // Don't cancel if this is the received list because it has
                // already been canceled in the other list, and trying to cancel
                // here will mess up the DOM.
                self.element.sortable("cancel");
            }

            // Put the nodes back exactly the way they started (this is very
            // important because ng-repeat uses comment elements to delineate
            // the start and stop of repeat sections and sortable doesn't
            // respect their order (even if we cancel, the order of the
            // comments are still messed up).
            sortingHelper = !ui.item.sortable.received && getSortingHelper(self.element, ui, self.savedNodes);

            // Restore all the savedNodes except from the sorting helper element.
            // That way it will be garbage collected.
            if (sortingHelper && sortingHelper.length) {
                self.savedNodes = self.savedNodes.not(sortingHelper);
            }

            elementContext = ui.item.sortable._getElementContext(self.element);
            self.savedNodes.appendTo(elementContext.savedNodesOrigin);

            // If this is the target connected list then
            // it's safe to clear the restored nodes since:
            // update is currently running and
            // stop is not called for the target list.
            if (ui.item.sortable.received) {
                self.savedNodes = null;
            }

            // If received is true (an item was dropped in from another list)
            // then we add the new item to this list otherwise wait until the
            // stop event where we will know if it was a sort or item was
            // moved here from another list
            if (ui.item.sortable.received && !ui.item.sortable.isCanceled()) {
                self.scope.$apply(function() {
                    self.ngModel.$modelValue.splice(
                        ui.item.sortable.dropindex,
                        0,
                        ui.item.sortable.moved
                    );
                });
            }
        };

        /**
         * stop
         * @param e
         * @param ui
         */
        callbacks.prototype.stop = function(e, ui) {
            var self = this,
                wasMoved,
                domOrderHasChanged,
                sortingHelper,
                elementContext;

            // If the received flag hasn't be set on the item, this is a
            // normal sort, if dropindex is set, the item was moved, so move
            // the items in the list.
            wasMoved = ("dropindex" in ui.item.sortable) && !ui.item.sortable.isCanceled();
            domOrderHasChanged = !angular.equals(self.element.contents().toArray(), self.savedNodes.toArray());

            if (wasMoved && !ui.item.sortable.received) {
                scope.$apply(function() {
                    ngModel.$modelValue.splice(
                        ui.item.sortable.dropindex,
                        0,
                        ngModel.$modelValue.splice(ui.item.sortable.index, 1)[0]
                    );
                });

            // if the item was not moved
            // and the DOM element order has changed,
            // then restore the elements
            // so that the ngRepeat's comment are correct.
            } else if (!wasMoved && domOrderHasChanged) {
                sortingHelper = getSortingHelper(self.element, ui, self.savedNodes);

                // Restore all the savedNodes except from the sorting helper element.
                // That way it will be garbage collected.
                if (sortingHelper && sortingHelper.length) {
                    self.savedNodes = self.savedNodes.not(sortingHelper);
                }

                elementContext = ui.item.sortable._getElementContext(self.element);
                self.savedNodes.appendTo(elementContext.savedNodesOrigin);
            }

            // It's now safe to clear the savedNodes
            // since stop is the last callback.
            self.savedNodes = null;
        };

        /**
         * An item was dropped here from another list, set a flag on the item
         * @param e
         * @param ui
         */
        callbacks.prototype.receive = function(e, ui) {
            ui.item.sortable.received = true;
        };

        /**
         * remove
         * @param e
         * @param ui
         */
        callbacks.prototype.remove = function(e, ui) {

            // Workaround for a problem observed in nested connected lists.
            // There should be an 'update' event before 'remove' when moving
            // elements. If the event did not fire, cancel sorting.
            if (!("dropindex" in ui.item.sortable)) {
                self.element.sortable("cancel");
                ui.item.sortable.cancel();
            }

            // Remove the item from this list's model and copy data into item,
            // so the next list can retrieve it
            if (!ui.item.sortable.isCanceled()) {
                self.scope.$apply(function() {
                    ui.item.sortable.moved = self.model.$modelValue.splice(
                        ui.item.sortable.index,
                        1
                    )[0];
                });
            }
        };

        return callback;
    }());

    /**
     * combineCallbacks
     * @param {Function} first
     * @param {Function} second
     * @returns {*}
     */
    var combineCallbacks = function (first, second) {
        var firstIsFunc = typeof first === "function",
            secondIsFunc = typeof second === "function";

        if (firstIsFunc && secondIsFunc) {
            return function () {
                first.apply(this, arguments);
                second.apply(this, arguments);
            };
        } else if (secondIsFunc) {
            return second;
        }

        return first;
    };

    /**
     * 
     * @param key
     * @param value
     * @param {angular.IScope} scope
     * @param {Callbacks} callbacks
     * @param {Wrappers} wrappers
     * @returns {*}
     */
    var patchSortableOption = function (key, value, scope, callbacks, wrappers) {
        if (callbacks[key]) {
            if (key === "stop") {
                // call apply after stop
                value = combineCallbacks(value, function() {
                     scope.$apply();
                });

                value = combineCallbacks(value, function (e, ui) {
                    ui.item.sortable._destroy();
                });
            }
            
            // wrap the callback
            value = combineCallbacks(callbacks[key], value);
        } else if (wrappers[key]) {
            value = wrappers[key](value);
        }

        // patch the options that need to have values set
        if (!value && (key === "items" || key === "ui-model-items")) {
            value = uiSortableConfig.items;
        }

        return value;
    };

    /**
     * hasSortingHelper
     * @param {angular.IAugmentedJQuery} element
     * @param ui
     * @returns {boolean|*}
     */
    var hasSortingHelper = function (element, ui) {
        //noinspection JSUnresolvedFunction
        var helperOption = element.sortable("option", "helper");
        return helperOption === "clone" || (typeof helperOption === "function" && ui.item.sortable.isCustomHelperUsed());
    };

    /**
     *
     * @param {angular.IAugmentedJQuery} element
     * @param ui
     * @param savedNodes
     * @returns {*}
     */
    var getSortingHelper = function(element, ui, savedNodes) {
        var result = null;
        
        //noinspection JSUnresolvedFunction
        if (hasSortingHelper(element, ui) &&
            element.sortable("option", "appendTo") === "parent") {
            
            // The .ui-sortable-helper element (that's the default class name) is placed last.
            result = savedNodes.last();
        }
        
        return result;
    };

    /**
     * isFloating
     * 
     * thanks jquery-ui
     * 
     * @param {angular.IAugmentedJQuery} item
     * @returns {boolean}
     */
    var isFloating = function(item) {
        return (/left|right/).test(item.css("float")) || (/inline|table-cell/).test(item.css("display"));
    };

    /**
     * 
     * @param {Array} elementScopes
     * @param {angular.IAugmentedJQuery} element
     * @returns {*}
     */
    var getElementContext = function(elementScopes, element) {
        var c, i;
        
        for (i = 0; i < elementScopes.length; i++) {
            c = elementScopes[i];
            
            if (c.element[0] === element[0]) {
                return c;
            }
        }
    };

    /**
     * 
     * @param callbacks
     * @param opts
     */
    var initializeOptsFromCallbacks = function(callbacks, opts) {
        angular.forEach(callbacks, function (value, key) {
            if (!(key in opts)) {
                opts[key] = null;
            }
        });
    };

    /**
     *
     * @param oldVals
     * @param newVal
     * @param opts
     * @param optsDiff
     * @param directiveOpts
     * @param {angular.IScope} scope
     * @param callbacks
     * @param wrappers
     */
    var resetDeletedOptions = function(oldVals, newVal, opts, optsDiff, directiveOpts, scope, callbacks, wrappers) {
        var defaultOptions;

        angular.forEach(oldVals,

            /**
             * @param {string} oldValue
             * @param {string} key
             */
            function (oldValue, key) {
                
                var defaultValue;
                
                if (newVal && (key in newVal)) {
                    return;
                }
                
                if (key in directiveOpts) {
                    if (key === "ui-floating") {
                        opts[key] = "auto";
                    } else {
                        opts[key] = patchSortableOption(key, undefined, scope, callbacks, wrappers);
                    }
                    
                    return;
                }

                if (!defaultOptions) {
                    
                    /** @namespace angular.element.ui */
                    defaultOptions = angular.element.ui.sortable().options;
                }
                
                defaultValue = defaultOptions[key];
                defaultValue = patchSortableOption(key, defaultValue, scope, callbacks, wrappers);

                if (!optsDiff) {
                    optsDiff = {};
                }
                
                optsDiff[key] = defaultValue;
                opts[key] = defaultValue;
            }
        );
    };

    /**
     * patchUISortableOptions
     * @param newVal
     * @param oldVal
     * @param opts
     * @param sortableWidgetInstance
     * @param {angular.IScope} scope
     * @param callbacks
     * @param wrappers
     */
    var patchUISortableOptions = function (newVal, oldVal, opts, sortableWidgetInstance, scope, callbacks, wrappers) {

        // only initialize it in case we have to
        // update some options of the sortable
        var optsDiff = null;
        
        // for this directive to work we have to attach some callbacks
        // add the key in the opts object so that
        // the patch function detects and handles it
        initializeOptsFromCallbacks(callbacks, opts);

        // reset deleted options to default
        if (oldVal) {
            resetDeletedOptions(oldVal, newVal, opts, optsDiff);
        }

        // update changed options
        angular.forEach(newVal,

            /**
             * @param {string} value
             * @param {string} key
             */
            function (value, key) {
            
                // if it's a custom option of the directive,
                // handle it appropriately
                if (key in directiveOpts) {
                    if (key === "ui-floating" && (value === false || value === true) && sortableWidgetInstance) {
                        sortableWidgetInstance.floating = value;
                    }
    
                    opts[key] = patchSortableOption(key, value, scope, callbacks, wrappers);
                    return;
                }
    
                value = patchSortableOption(key, value, scope, callbacks, wrappers);
    
                if (!optsDiff) {
                    optsDiff = {};
                }
                
                optsDiff[key] = value;
                opts[key] = value;
            }
        );

        return optsDiff;
    };

    /**
     * init
     * @param {angular.IScope} scope
     * @param {angular.IAugmentedJQuery} element
     * @param {angular.INgModelController} ngModel
     * @param opts
     */
    var init = function (scope, element, ngModel, opts) {
        if (!ngModel) {
            log.info("ui.sortable: ngModel not provided!", element);

        } else {

            // When we add or remove elements, we need the sortable to 'refresh'
            // so it can find the new/removed elements.
            scope.$watchCollection("ngModel",
                function (newValue) {

                    // Timeout to let ng-repeat modify the DOM
                    timeout(function () {
                        console.log("sortable");
                        console.dir(newValue);

                        // ensure that the jquery-ui-sortable widget instance
                        // is still bound to the directive's element
                        if (!!getSortableWidgetInstance(element)) {
                            
                            //noinspection JSUnresolvedFunction
                            element.sortable("refresh");
                        }

                    }, 0, false);
                });

            scope.$watchCollection("uiSortable",
                function (newVal, oldVal) {
                    var optsDiff,
                        sortableWidgetInstance;
                    
                    // ensure that the jquery-ui-sortable widget instance
                    // is still bound to the directive's element
                    sortableWidgetInstance = getSortableWidgetInstance(element);
                    
                    if (!!sortableWidgetInstance) {
                        optsDiff = patchUISortableOptions(newVal, oldVal, opts, sortableWidgetInstance, scope, callbacks, wrappers);

                        if (optsDiff) {
                            
                            //noinspection JSUnresolvedFunction
                            element.sortable("option", optsDiff);
                        }
                    }
                },
                true);

            // @todo Sean you stopped here. Need to make each method accept an object with all the attributes 
            // @todo instead of how it is now
            patchUISortableOptions(opts);
        }

        // Create sortable
        //noinspection JSUnresolvedFunction
        element.sortable(opts);
    };

    /**
     * isDisabled
     * @param scope
     * @namespace scope.uiSortable
     * @return {boolean}
     */
    var isDisabled = function(scope) {
        return scope.uiSortable && scope.uiSortable.disabled;
    };

    /**
     * link
     * @param scope
     * @param {angular.IAugmentedJQuery} element
     * @param {angular.IAttributes} attrs
     * @param {angular.INgModelController} ngModel
     * @namespace scope.uiSortable
     */
    var link = function (scope, element, attrs, ngModel) {
        var opts = {},
            cancelWatcher = angular.noop;

        if (!angular.element.fn || !angular.element.fn.jquery) {
            log.error("ui.sortable: jQuery should be included before AngularJS!");
            return;
        }

        directiveOpts["ui-floating"] = undefined;
        directiveOpts["ui-model-items"] = uiSortableConfig.items;
        angular.extend(opts, directiveOpts, uiSortableConfig, scope.uiSortable);

        if (isDisabled(scope)) {
            cancelWatcher = scope.$watch("uiSortable.disabled",
                function() {
                    if (!isDisabled(scope)) {
                        cancelWatcher();
                        init(scope, element, ngModel, opts);
                        cancelWatcher = angular.noop;
                    }
                });
        } else {
            init(scope, element, ngModel, opts);
        }
    };

    /**
     * constructor
     * @param _uiSortableConfig
     * @param {angular.ITimeoutService} $timeout
     * @param {angular.ILogService} $log
     */
    var constructor = function (_uiSortableConfig, $timeout, $log) {
        uiSortableConfig = _uiSortableConfig;
        timeout = $timeout;
        log = $log;

        return {
            require: "?ngModel",
            link: link,
            scope: {
                ngModel: "=",
                uiSortable: "="
            }
        };
    };

    /**
     * The default for jquery-ui sortable is "> *", we need to restrict this to
     * ng-repeat items
     * if the user uses
     */
    module.value("uiSortableConfig", {
        items: "> [ng-repeat],> [data-ng-repeat],> [x-ng-repeat]"
    });

    module.directive("uiSortable", ["uiSortableConfig", "timeout", "log", constructor]);

})(angular.module("ui.sortable", []));
