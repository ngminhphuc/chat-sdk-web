import * as angular from 'angular'
import * as $ from 'jquery'

import {IUserListScope} from "../controllers/user-list";
import {Utils} from "../services/utils";
import {IUser} from "../entities/user";
import {IRootScope} from "../interfaces/root-scope";
import {IScreen} from "../services/screen";

export interface IDraggableUser {

}

export class UserDragAction {

    public user: IUser = null;
    // Initial position
    public x0 = 0;
    public y0 = 0;

    // Current position
    public x = 0;
    public y = 0;

    public dragging = true;
    public dropLoc = false;
    public visible = false;

    constructor (user: IUser, x0: number, y0: number) {
        this.user = user;
        this.x0 = x0;
        this.y0 = y0;
    }

    distanceMoved (x: number, y: number): number {
        return Math.sqrt(Math.pow(x - this.x0, 2) + Math.pow(y - this.y0, 2))
    }
}

class DraggableUser implements IDraggableUser {

    static $inject = ['$rootScope', '$timeout', 'Screen'];

    constructor (private $rootScope: IRootScope,
                 private $timeout: ng.ITimeoutService,
                 private Screen: IScreen) {

    }

    public link = (scope: IUserListScope, elm) => {
        this.$rootScope.userDrag = null;
        const $elm = $(elm);

        $elm.mousedown((e) => {
            this.$rootScope.userDrag = new UserDragAction(scope.aUser, e.clientX, e.clientY);

            Utils.stopDefault(e);

            return false;

        });

        $(document).mousemove((e) => {

            const userDrag = this.$rootScope.userDrag;

            if (userDrag && userDrag.dragging) {

                const x = e.clientX;
                const y = e.clientY;

                userDrag.visible = userDrag.distanceMoved(x, y) > 10;

                userDrag.x = x - 20;
                userDrag.y = y - $elm.height() / 2;

                userDrag.x = Math.max(userDrag.x, 0);
                userDrag.x = Math.min(userDrag.x, this.Screen.screenWidth);

                userDrag.y = Math.max(userDrag.y, 0);
                userDrag.y = Math.min(userDrag.y, this.Screen.screenHeight - $elm.height());

                // If we're in the drop loc
                this.$timeout(() => {
                    scope.$apply();
                });
            }

        });

        $(document).mouseup((e) => {

            const userDrag = this.$rootScope.userDrag;

            if (userDrag && userDrag.dragging) {
                userDrag.dragging = false;
                userDrag.visible = false;

                this.$timeout(() => {
                    scope.$apply();
                });
            }
        });
    };

    static factory (): ng.IDirectiveFactory {
        return ($rootScope: IRootScope, $timeout: ng.ITimeoutService, Screen: IScreen) => new DraggableUser($rootScope, $timeout, Screen)
    }

}

angular.module('myApp.directives').directive('draggableUser', DraggableUser.factory());