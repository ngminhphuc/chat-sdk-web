import { database } from 'firebase';

import { IRoomMeta } from '../interfaces/room-meta';
import { IRootScope } from '../interfaces/root-scope';
import { IStringAnyObject } from '../interfaces/string-any-object';
import { Dimensions } from '../keys/dimensions';
import { MessageKeys } from '../keys/message-keys';
import { MessageType } from '../keys/message-type';
import { N } from '../keys/notification-keys';
import { RoomKeys } from '../keys/room-keys';
import { RoomType } from '../keys/room-type';
import { UserKeys } from '../keys/user-keys';
import { UserStatus } from '../keys/user-status';
import { IFirebaseReference, IPaths } from '../network/paths';
import { IPresence } from '../network/presence';
import { ICache } from '../persistence/cache';
import { IUserStore } from '../persistence/user-store';
import { ICloudImage } from '../services/cloud-image';
import { IConfig } from '../services/config';
import { IEnvironment } from '../services/environment';
import { Log } from '../services/log';
import { IMarquee } from '../services/marquee';
import { IRoomFactory } from '../services/room-factory';
import { IRoomPositionManager } from '../services/room-position-manager';
import { ISoundEffects } from '../services/sound-effects';
import { ITime } from '../services/time';
import { Utils } from '../services/utils';
import { IVisibility } from '../services/visibility';
import { Entity, IEntity } from './entity';
import { IMessage, IMessageFactory } from './message';
import { IUser } from './user';
import { RoomsPath, MessagesPath } from '../keys/path-keys';
import { RoomDefaultNamePublic, RoomDefaultNameEmpty, RoomDefaultNameGroup, RoomDefaultName1To1 } from '../keys/room-name-keys';
import { From, Creator, CreatorEntityID, SenderEntityID, MessageKey, ThreadKey, DateKey, DetailsKey, userUID } from '../keys/keys';
import { DEBUG } from '../keys/defines';

export interface IRoom extends IEntity {
  active: boolean;
  associatedUserID: string;
  badge: number;
  deleted: boolean;
  deletedTimestamp: number;
  dragDirection: number;
  draggable: boolean;
  height: number;
  invitedBy: IUser;
  isOpen: boolean;
  messages: IMessage[];
  minimized: boolean;
  name: string;
  offset: number;
  onlineUserCount: number;
  slot: number;
  type: RoomType;
  usersMeta: IStringAnyObject;
  width: number;
  zIndex: number;
  addUserUpdate(user: IUser, status: UserStatus): {};
  close(): void;
  containsOnlyUsers(users: IUser[]): boolean;
  containsUser(user: IUser): boolean;
  created(): number;
  deserialize(sr: IStringAnyObject): void;
  finishTyping(user: IUser): Promise<any>;
  flashHeader(): boolean;
  getOnlineUserCount(): number;
  getRID(): string;
  getType(): RoomType;
  getUsers(): { [uid: string]: IUser };
  getUserStatus(user: IUser): UserStatus;
  isPublic(): boolean;
  join(status: UserStatus): Promise<any>;
  lastMessage(): IMessage;
  lastMessageTime(): number;
  leave(): void;
  loadMoreMessages(numberOfMessages?: number): Promise<Array<IMessage>>;
  messagesOn(timestamp: number): void;
  off(): void;
  on(): Promise<any>;
  open(slot: number, duration?: number): void;
  removeUserUpdate(user: IUser): {};
  rid(): string;
  sendFileMessage(user: IUser, fileName: string, mimeType: string, fileURL: string): Promise<any>;
  sendImageMessage(user: IUser, url: string, width: number, height: number): Promise<any>;
  sendTextMessage(user: IUser, text: string): Promise<any>;
  setActive(active: boolean): void;
  setOffset(offset: number): void;
  setSizeToDefault(): void;
  startTyping(user: IUser): Promise<any>;
  transcript(): string;
  trimMessageList(): void;
  typingOn(): void;
  updateOffsetFromSlot(): void;
  updateType(): void;
}

export class Room extends Entity implements IRoom {

  users = {};
  usersMeta = {};
  onlineUserCount = 0;
  messages = [];
  typing = {};
  typingMessage = '';
  badge = 0;
  isOn = false;
  draggable: boolean;
  type: RoomType;

  // Layout
  offset: number; // The x offset
  dragDirection = 0; // drag direction +ve / -ve

  width = Dimensions.ChatRoomWidth;
  height = Dimensions.ChatRoomHeight;
  zIndex = null;
  active = true; // in side list or not
  minimized = false;
  loadingMoreMessages = false;
  loadingTimer = null;
  muted = false;
  invitedBy: IUser;

  // Has the room been deleted?
  deleted = false;
  // When was the room deleted?
  deletedTimestamp = null;

  isOpen = false;
  readTimestamp = 0; // When was the thread last read?

  thumbnail = this.Environment.defaultRoomPictureURL();
  showImage = false;

  // The room associated with this use
  // this is used to make sure that if a user logs out
  // the next user who logs in doesn't see their
  // inbox
  associatedUserID = null;

  // TODO: Check this
  name = '';

  slot: number;
  unreadMessages: Array<IMessage>;

  userOnlineStateChangedNotificationOff?: () => void;

  messagesAreOn: boolean;

  constructor(
    private $rootScope: IRootScope,
    private Presence: IPresence,
    Paths: IPaths,
    private Config: IConfig,
    private MessageFactory: IMessageFactory,
    private Cache: ICache,
    private UserStore: IUserStore,
    private RoomPositionManager: IRoomPositionManager,
    private SoundEffects: ISoundEffects,
    private Visibility: IVisibility,
    private Time: ITime,
    private CloudImage: ICloudImage,
    private Marquee: IMarquee,
    private Environment: IEnvironment,
    private RoomFactory: IRoomFactory,
    rid: string,
    meta?: IRoomMeta,
  ) {
    super(Paths, RoomsPath, rid);
    if (meta) {
      this.setMeta(meta);
    }
  }

  /***********************************
   * GETTERS AND SETTERS
   */

  getRID(): string {
    return this.rid();
  }

  getUserCreated(): boolean {
    return this.metaValue(RoomKeys.UserCreated);
  }

  /***********************************
   * UPDATE METHOD
   */

  /**
   * If silent is true then this will not broadcast to update the UI.
   * Primarily this is used when deserializing
   */
  update(silent = false) {
    this.updateName();
    // TODO: Check
    this.setImage(this.metaValue(RoomKeys.Image));
    this.updateOnlineUserCount();
    if (!silent) {
      this.$rootScope.$broadcast(N.RoomUpdated, this);
    }
  }

  updateTyping() {

    let i = 0;
    let name = null;
    for (const key in this.typing) {
      if (this.typing.hasOwnProperty(key)) {
        if (key === this.UserStore.currentUser().uid()) {
          continue;
        }
        name = this.typing[key];
        i++;
      }
    }

    let typing = null;
    if (i === 1) {
      typing = name + '...';
    }
    else if (i > 1) {
      typing = i + ' people typing';
    }

    this.typingMessage = typing;
  }

  updateOnlineUserCount() {
    this.onlineUserCount = this.getOnlineUserCount();
  }

  updateName() {
    // If the room already has a name
    // use it
    const name = this.metaValue(RoomKeys.Name);
    if (name && name.length) {
      this.name = name;
      return;
    }

    // Otherwise build a room based on the users' names
    this.name = '';
    for (const key in this.users) {
      if (this.users.hasOwnProperty(key)) {
        const user = this.users[key];
        if (!user.isMe() && user.getName() && user.getName().length) {
          this.name += user.getName() + ', ';
        }
      }
    }
    if (this.name.length >= 2) {
      this.name = this.name.substring(0, this.name.length - 2);
    }

    // Private chat x users
    // Ben Smiley
    if (!this.name || !this.name.length) {
      if (this.isPublic()) {
        this.name = RoomDefaultNamePublic;
      }
      else if (this.userCount() === 1) {
        this.name = RoomDefaultNameEmpty;
      }
      else if (this.getType() === RoomType.Group) {
        this.name = RoomDefaultNameGroup;
      }
      else {
        this.name = RoomDefaultName1To1;
      }
    }
  }

  /***********************************
   * LIFECYCLE: on -> open -> closed -> off
   */

  on(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.isOn && this.rid()) {
        this.isOn = true;

        const on = () => {
          // When a user changes online state update the room
          this.userOnlineStateChangedNotificationOff = this.$rootScope.$on(N.UserOnlineStateChanged, (event, user: IUser) => {
            Log.notification(N.UserOnlineStateChanged, 'Room');
            // If the user is a member of this room, update the room
            if (this.containsUser(user)) {
              this.update();
            }
          });
          this.$rootScope.$on(N.UserValueChanged, (event, user: IUser) => {
            if (this.containsUser(user)) {
              this.update();
            }
          });


          this.usersMetaOn();
          this.messagesOn(this.deletedTimestamp);

          resolve();
        };

        // First get the meta
        this.metaOn().then(() => {

          switch (this.getType()) {
            case RoomType.OneToOne:
              this.deleted = false;
              this.userDeletedDate().then((timestamp) => {
                if (timestamp) {
                  this.deleted = true;
                  this.deletedTimestamp = timestamp;
                }
                on();
              });
              break;
            case RoomType.Public:
            case RoomType.Group:
              on();
              break;
            default:
              resolve();
          }

        });
      }
      else {
        resolve();
      }
    });
  }

  open(slot: number, duration = 300): void {
    const open = () => {
      // Add the room to the UI
      this.RoomPositionManager.insertRoom(this, slot, duration);

      // Start listening to message updates
      this.messagesOn(this.deletedTimestamp);

      // Start listening to typing indicator updates
      this.typingOn();

      // Update the interface
      this.$rootScope.$broadcast(N.RoomAdded);
    };

    switch (this.getType()) {
      case RoomType.Public:
        this.join(UserStatus.Member).then(() => open(), (error) => {
          console.log(error);
        });
        break;
      case RoomType.Group:
      case RoomType.OneToOne:
        open();
    }
  }

  /**
   * Removes the room from the display
   * and leaves the room
   */
  close(): void {

    this.typingOff();
    this.messagesOff();

    const type = this.getType();

    switch (type) {
      case RoomType.Public: {
          this.RoomFactory.removeUserFromRoom(this.UserStore.currentUser(), this);
        }
    }

    this.RoomPositionManager.closeRoom(this);
  }

  async leave(): Promise<any> {
    this.deleteMessages();
    this.$rootScope.$broadcast(N.RoomRemoved);
    this.deleted = true;
    await this.RoomFactory.removeUserFromRoom(this.UserStore.currentUser(), this);
    this.off();
  }

  off() {
    this.isOn = false;

    if (this.userOnlineStateChangedNotificationOff) {
      this.userOnlineStateChangedNotificationOff();
    }

    this.metaOff();
    this.usersMetaOff();
  }

  getType(): RoomType {
    let type = parseInt(this.metaValue(RoomKeys.Type));
    if (!type) {
      type = parseInt(this.metaValue(RoomKeys.Type_v4));
    }
    return type;
  }

  calculatedType(): RoomType {

    let type: RoomType = null;

    if (this.isPublic()) {
      type = RoomType.Public;
    }
    else {
      if (this.userCount() <= 1) {
        type = RoomType.Invalid;
      }
      else if (this.userCount() === 2) {
        type = RoomType.OneToOne;
      }
      else {
        type = RoomType.Group;
      }
    }

    return type;
  }

  updateType() {
    const type = this.calculatedType();
    if (type !== this.getType()) {
      // One important thing is that we can't go from group -> 1to1
      if (this.getType() !== RoomType.Group) {
        this.RoomFactory.updateRoomType(this.rid(), type);
      }
    }
  }

  /**
   * Message flagging
   */

  toggleMessageFlag(message: IMessage) {
    if (message.flagged) {
      return this.unflagMessage(message);
    }
    else {
      return this.flagMessage(message);
    }
  }

  async flagMessage(message: IMessage) {

    message.flagged = true;

    const ref = this.Paths.flaggedMessageRef(message.mid);

    const data = {};

    data[Creator] = this.UserStore.currentUser().uid();
    data[CreatorEntityID] = data[Creator];

    data[From] = message.metaValue(MessageKeys.UserFirebaseID);
    data[SenderEntityID] = data[From];

    data[MessageKey] = message.text();
    data[ThreadKey] = message.rid;
    data[DateKey] = database.ServerValue.TIMESTAMP;

    await ref.set(data);
    message.flagged = false;
    this.$rootScope.$broadcast(N.ChatUpdated, this);
  }

  async unflagMessage(message: IMessage) {
    message.flagged = false;

    const ref = this.Paths.flaggedMessageRef(message.mid);
    await ref.remove();
    message.flagged = true;
    this.$rootScope.$broadcast(N.ChatUpdated, this);
  }

  isPublic(): boolean {
    return this.getType() === RoomType.Public;
  }

  rid(): string {
    return this._id;
  }

  created(): number {
    return this.metaValue(RoomKeys.Created);
  }

  lastMessageExists(): boolean {
    return this.messages.length > 0;
  }

  lastMessageType(): MessageType {
    if (this.lastMessageExists()) {
      this.lastMessage().type();
    }
    return null;
  }

  lastMessage(): IMessage {
    if (this.lastMessageExists()) {
      return this.messages[this.messages.length - 1];
    }
    return null;
  }

  lastMessageUserName(): string {
    if (this.lastMessageExists()) {
      return this.lastMessage().user.getName();
    }
    return null;
  }

  lastMessageTime(): number {
    if (this.lastMessageExists()) {
      return this.lastMessage().time();
    }
    return null;
  }

  lastMessageDate(): Date {
    if (this.lastMessageExists()) {
      return this.lastMessage().date();
    }
    return null;
  }

  lastMessageText(): string {
    if (this.lastMessageExists()) {
      return this.lastMessage().text();
    }
    return null;
  }

  /**
   * Add the user to the room and add the room to the
   * user in Firebase
   */
  join(status: UserStatus): Promise<any> {
    return this.RoomFactory.addUserToRoom(this.UserStore.currentUser(), this, status);
  }

  setActive(active: boolean) {
    if (active) {
      this.markRead();
    }
    this.active = active;
  }

  setSizeToDefault() {
    this.width = Dimensions.ChatRoomWidth;
    this.height = Dimensions.ChatRoomHeight;
  }

  flashHeader(): boolean {
    // TODO: Implement this
    // Ideally if the chat is in the side bar then bring it
    // to the front
    // Or flash the side bar
    if (this.RoomPositionManager.roomIsOpen(this)) {
      this.$rootScope.$broadcast(N.RoomFlashHeader, this, '#555', 500, 'room-header');
      this.$rootScope.$broadcast(N.RoomFlashHeader, this, '#CCC', 500, 'room-list');
      return true;
    }
    return false;
  }

  /***********************************
   * USERS
   */

  getUserInfoWithUID(uid: string) {
    // This could be called from the UI so it's important
    // to wait until users has been populated
    if (this.usersMeta) {
      return this.usersMeta[uid];
    }
    return null;
  }

  getUserInfo(user: IUser) {
    // This could be called from the UI so it's important
    // to wait until users has been populated
    if (user && user.meta) {
      return this.getUserInfoWithUID(user.uid());
    }
    return null;
  }

  getUserStatus(user: IUser): UserStatus {
    const info = this.getUserInfo(user);
    return info ? info[UserKeys.Status] : null;
  }

  getUsers(): { [uid: string]: IUser } {
    const users = {};
    for (const key in this.users) {
      if (this.users.hasOwnProperty(key)) {
        const user = this.users[key];
        if (user.meta && this.UserStore.currentUser() && this.UserStore.currentUser().meta) {
          if (user.uid() !== this.UserStore.currentUser().uid()) {
            users[user.uid()] = user;
          }
        }
      }
    }
    return users;
  }

  getUserIDs(): Array<string> {
    const users = new Array<string>();
    for (const key in this.users) {
      if (this.users.hasOwnProperty(key)) {
        users.push(key);
      }
    }
    return users;
  }

  // userIsActiveWithUID(uid) {
  //     let info = this.getUserInfo(uid);
  //     return this.RoomFactory.userIsActiveWithInfo(info);
  // };

  getOwner(): IUser {
    // get the owner's ID
    let data = null;

    for (const key in this.usersMeta) {
      if (this.usersMeta.hasOwnProperty(key)) {
        data = this.usersMeta[key];
        if (data.status === UserStatus.Owner) {
          break;
        }
      }
    }
    if (data) {
      return this.UserStore.getOrCreateUserWithID(data.uid);
    }
    return null;
  }

  //        isClosed() {
  //            return this.getUserStatus(this.UserStore.currentUser()) == UserStatusClosed;
  //        };

  containsUser(user: IUser) {
    return this.users[user.uid()] != null;
  }

  // Update the timestamp on the user status
  // updateUserStatusTime(user): Promise<any> {
  //
  //     let data = {
  //         time: firebase.database.ServerValue.TIMESTAMP
  //     };
  //
  //     let ref = this.Paths.roomUsersRef(this.rid());
  //     return ref.child(user.uid()).update(data);
  // };

  /***********************************
   * ROOM INFORMATION
   */

  getOnlineUserCount() {
    let i = 0;
    for (const key in this.usersMeta) {
      if (this.usersMeta.hasOwnProperty(key)) {
        const user = this.usersMeta[key];
        if (this.UserStore.currentUser() && this.UserStore.currentUser().meta) {
          if ((this.UserStore.users[user.uid].online || this.UserStore.currentUser().uid() === user.uid)) {
            i++;
          }
        }
      }
    }
    return i;
  }

  userCount() {
    let i = 0;
    for (const key in this.users) {
      if (this.users.hasOwnProperty(key)) {
        i++;
      }
    }
    return i;
  }

  containsOnlyUsers(users: IUser[]) {
    let usersInRoom = 0;
    const totalUsers = this.userCount();

    for (const user of users) {
      if (this.users[user.uid()]) {
        usersInRoom++;
      }
    }
    return usersInRoom === users.length && usersInRoom === totalUsers;
  }

  /***********************************
   * LAYOUT
   */

  // If the room is animating then
  // return the destination
  getOffset(): number {
    return this.offset;
  }

  getCenterX(): number {
    return this.getOffset() + this.width / 2;
  }

  getMinX(): number {
    return this.getOffset();
  }

  getMaxX(): number {
    return this.getOffset() + this.width;
  }

  updateOffsetFromSlot() {
    this.setOffset(this.RoomPositionManager.offsetForSlot(this.slot));
  }

  setOffset(offset: number) {
    this.offset = offset;
  }

  setSlot(slot: number) {
    this.slot = slot;
  }

  /***********************************
   * MESSAGES
   */

  sendImageMessage(user: IUser, url: string, width: number, height: number): Promise<any> {
    const meta = this.MessageFactory.buildImageMeta(url, width, height);
    const messageMeta = this.MessageFactory.buildMessage(user.uid(), this.getUserIDs(), MessageType.Image, meta);
    return this.sendMessage(messageMeta, user);
  }

  sendFileMessage(user: IUser, fileName: string, mimeType: string, fileURL: string): Promise<any> {
    const meta = this.MessageFactory.buildFileMeta(fileName, mimeType, fileURL);
    const messageMeta = this.MessageFactory.buildMessage(user.uid(), this.getUserIDs(), MessageType.File, meta);
    return this.sendMessage(messageMeta, user);
  }

  sendTextMessage(user: IUser, text: string): Promise<any> {
    if (!text || text.length === 0) {
      return;
    }
    const meta = this.MessageFactory.buildTextMeta(text);
    const messageMeta = this.MessageFactory.buildMessage(user.uid(), this.getUserIDs(), MessageType.Text, meta);
    return this.sendMessage(messageMeta, user);
  }

  sendMessage(messageMeta: {}, user: IUser): Promise<any> {
    const innerSendMessage = (() => {

      // Get a ref to the room
      const ref = this.Paths.roomMessagesRef(this.rid());

      // Add the message
      const newRef = ref.push() as IFirebaseReference;

      const p1 = newRef.setWithPriority(messageMeta, database.ServerValue.TIMESTAMP);

      // The user's been active so update their status
      // with the current time
      // this.updateUserStatusTime(user);

      // Avoid a clash..
      const p2 = this.updateState(MessagesPath);

      return Promise.all([
        p1, p2
      ]);

    });

    return innerSendMessage().catch((error) => {
      this.Presence.update().then(() => {
        return innerSendMessage();
      });
    });
  }

  addMessagesFromSerialization(sm) {
    for (const s of sm) {
      this.addMessageFromSerialization(s);
    }
    // Now update all the message displays

  }

  addMessageFromSerialization(sm) {
    const message = this.getMessageFromMeta(sm.mid, sm.meta);
    message.deserialize(sm);
    this.addMessageToEnd(message, true);
  }

  getMessageFromMeta(mid: string, metaValue: Map<string, any>) {
    return this.MessageFactory.createMessage(mid, metaValue);
  }

  getMessagesNewerThan(date: Date = null, amount: number = null): Array<IMessage> {
    const messages = new Array<IMessage>();
    for (const message of this.messages) {
      if (!date || message.date() > date) {
        messages.push(message);
      }
    }
    return messages;
  }

  addMessageToStart(message: IMessage, silent = true): void {
    if (this.messages.length) {
      const nextMessage = this.messages[0];
      nextMessage.previousMessage = message;
      message.nextMessage = nextMessage;
      message.updateDisplay();
      nextMessage.updateDisplay();
    }
    this.messages.unshift(message);
    this.update(silent);
  }

  addMessageToEnd(message: IMessage, silent = false): void {
    if (this.messages.length) {
      const previousMessage = this.messages[this.messages.length - 1];
      previousMessage.nextMessage = message;
      message.previousMessage = previousMessage;
      message.updateDisplay();
      previousMessage.updateDisplay();
    }
    this.updateBadgeForMessage(message);
    this.messages.push(message);

    if (message.user && !silent) {
      this.Marquee.startWithMessage(message.user.getName() + ': ' + message.text());
    }

    this.update(silent);
  }

  updateBadgeForMessage(message: IMessage): void {
    if (this.shouldIncrementUnreadMessageBadge() && !message.read && (message.time() > this.readTimestamp || !this.readTimestamp)) {

      if (!this.unreadMessages) {
        this.unreadMessages = [];
      }

      this.unreadMessages.push(message);
    }
    else {
      // Is the room active? If it is then mark the message
      // as seen
      message.markRead();
    }
  }

  getMessagesOlderThan(date: Date = null, amount: number = null): Array<IMessage> {
    const messages = new Array<IMessage>();
    for (const message of this.messages) {
      if (!date || message.date() < date) {
        messages.push(message);
      }
    }
    return messages;
  }

  loadLocalMessages(fromDate: Date, amount: number): Array<IMessage> {
    const messages = new Array<IMessage>();

    return messages;
  }

  // Load m
  loadMessagesOlderThan(date: Date = null, amount: number): Promise<Array<IMessage>> {

    const ref = this.Paths.roomMessagesRef(this.rid());
    let query = ref.orderByChild(MessageKeys.Date).limitToLast(amount);

    if (date) {
      query = query.endAt(date.getTime() - 1, MessageKeys.Date);
    }

    return query.once('value').then((snapshot: firebase.database.DataSnapshot) => {
      const data = snapshot.val();
      const messages = new Array<IMessage>();
      if (data) {
        Object.keys(data).forEach(key => {
          messages.push(this.MessageFactory.createMessage(key, data[key]));
        });
      }
      return messages;
    }).catch((e) => {
      console.log(e.message);
    }) as Promise<Array<IMessage>>;
  }

  loadMoreMessages(numberOfMessages: number = 10): Promise<Array<IMessage>> {

    if (this.loadingMoreMessages) {
      return Promise.resolve([]);
    }
    this.loadingMoreMessages = true;

    let date = null;
    if (this.messages.length) {
      date = this.messages[0].date();
    }

    return this.loadMessagesOlderThan(date, numberOfMessages).then(messages => {

      const len = messages.length - 1;
      for (let i = 0; i < messages.length; i++) {
        this.addMessageToStart(messages[len - i]);
      }


      // Add messages to front of global list
      // Ignore the last message - it's a duplicate
      // let lastMessage = null;
      // for (let i = messages.length - 2; i >= 0; i--) {
      //     if (this.messages.length > 0) {
      //         lastMessage = this.messages[0];
      //     }
      //     this.messages.unshift(messages[i]);
      //     if (lastMessage) {
      //         lastMessage.hideName = lastMessage.shouldHideUser(messages[i]);
      //         lastMessage.hideTime = lastMessage.shouldHideDate(messages[i]);
      //     }
      // }

      this.loadingMoreMessages = false;

      this.$rootScope.$broadcast(N.LazyLoadedMessages, this);

      return messages;
    });
  }

  sortMessages() {
    // Now we should sort all messages
    this.sortMessageArray(this.messages);
  }

  deduplicateMessages() {
    const uniqueMessages = [];

    // Deduplicate list
    let lastMID = null;
    for (const message of this.messages) {
      if (message.mid !== lastMID) {
        uniqueMessages.push(message);
      }
      lastMID = message.mid;
    }

    this.messages = uniqueMessages;

  }

  deleteMessages() {
    this.messages.length = 0;
    if (this.unreadMessages) {
      this.unreadMessages.length = 0;
    }
  }

  sortMessageArray(messages) {
    messages.sort((a, b) => {
      return a.time() - b.time();
    });
  }

  markRead() {

    const messages = this.unreadMessages;

    if (messages && messages.length > 0) {

      for (const i in messages) {
        if (messages.hasOwnProperty(i)) {
          messages[i].markRead();
        }
      }

      // Clear the messages array
      while (messages.length > 0) {
        messages.pop();
      }
    }
    this.badge = 0;
    this.sendBadgeChangedNotification();

    // Mark the date when the thread was read
    if (!this.isPublic()) {
      this.UserStore.currentUser().markRoomReadTime(this.rid());
    }

  }

  updateImageURL(imageURL) {
    // Compare to the old URL
    const imageChanged = imageURL !== this.metaValue(RoomKeys.Image);
    if (imageChanged) {
      this.setMetaValue(RoomKeys.Image, imageURL);
      this.setImage(imageURL, false);
      return this.pushMeta();
    }
  }

  setImage(image, isData = false) {

    this.showImage = this.getType() === RoomType.Public;

    if (!image) {
      image = this.Environment.defaultRoomPictureURL();
    }
    else {
      if (isData || image === this.Environment.defaultRoomPictureURL()) {
        this.thumbnail = image;
      }
      else {
        this.thumbnail = this.CloudImage.cloudImage(image, 30, 30);
      }
    }
  }

  pushMeta(): Promise<any> {
    const ref = this.Paths.roomMetaRef(this.rid());
    return ref.update(this.getMetaObject()).then(() => {
      return this.updateState(DetailsKey);
    });
  }

  sendBadgeChangedNotification() {
    this.$rootScope.$broadcast(N.LazyLoadedMessages, this);
  }

  transcript(): string {

    let transcript = '';

    for (const i in this.messages) {
      if (this.messages.hasOwnProperty(i)) {
        const m = this.messages[i];
        transcript += this.Time.formatTimestamp(m.time()) + ' ' + m.user.getName() + ': ' + m.text() + '\n';
      }
    }

    return transcript;
  }

  /***********************************
   * TYPING INDICATOR
   */

  startTyping(user: IUser): Promise<any> {
    // The user is typing...
    const ref = this.Paths.roomTypingRef(this.rid()).child(user.uid());
    const promise = ref.set({ name: user.getName() });

    // If the user disconnects, tidy up by removing the typing
    // indicator
    ref.onDisconnect().remove();
    return promise;
  }

  finishTyping(user: IUser): Promise<any> {
    const ref = this.Paths.roomTypingRef(this.rid()).child(user.uid());
    return ref.remove();
  }

  /***********************************
   * SERIALIZATION
   */

  serialize(): {} {
    const superData = super.serialize();

    const m = [];
    for (const message of this.messages) {
      m.push(message.serialize());
    }
    const data = {
      minimized: this.minimized,
      width: this.width,
      height: this.height,
      // offset: this.offset,
      messages: m,
      usersMeta: this.usersMeta,
      deleted: this.deleted,
      isOpen: this.isOpen,
      // badge: this.badge,
      associatedUserID: this.associatedUserID,
      offset: this.offset,
      readTimestamp: this.readTimestamp,
    };
    return { ...superData, ...data };
  }

  deserialize(sr): void {
    if (sr) {
      super.deserialize(sr);
      this.minimized = sr.minimized;
      this.width = sr.width;
      this.height = sr.height;
      this.deleted = sr.deleted;
      this.isOpen = sr.isOpen;
      // this.badge = sr.badge;
      this.associatedUserID = sr.associatedUserID;
      this.offset = sr.offset;
      this.readTimestamp = sr.readTimestamp;

      // this.setUsersMeta(sr.usersMeta);

      for (const key in sr.usersMeta) {
        if (sr.usersMeta.hasOwnProperty(key)) {
          this.addUserMeta(sr.usersMeta[key]);
        }
      }
      // this.offset = sr.offset;

      this.addMessagesFromSerialization(sr.messages);

    }
  }

  /***********************************
   * FIREBASE
   */

  /**
   * Start listening to updates in the
   * room meta data
   */
  metaOn() {
    return this.pathOn(DetailsKey, (val) => {
      if (val) {
        this.setMeta(val);
        this.update();
      }
    });
  }

  metaOff() {
    this.pathOff(DetailsKey);
  }

  addUserMeta(meta) {
    // We only display users who have been active
    // recently
    // if (this.RoomFactory.userIsActiveWithInfo(meta)) {
    this.usersMeta[meta[userUID]] = meta;

    // Add the user object
    const user = this.UserStore.getOrCreateUserWithID(meta[userUID]);
    this.users[user.uid()] = user;

    this.update(false);
    // }
  }

  removeUserMeta(meta) {
    delete this.usersMeta[meta[userUID]];
    delete this.users[meta[userUID]];
    this.update(false);
  }

  usersMetaOn() {

    const roomUsersRef = this.Paths.roomUsersRef(this.rid());

    roomUsersRef.on('child_added', (snapshot) => {
      if (snapshot.val() && snapshot.val()) {
        const meta = snapshot.val();
        meta.uid = snapshot.key;
        this.addUserMeta(meta);
      }
    });

    roomUsersRef.on('child_removed', (snapshot) => {
      if (snapshot.val()) {
        const meta = snapshot.val();
        meta.uid = snapshot.key;
        this.removeUserMeta(meta);
      }
    });
  }

  usersMetaOff() {
    this.Paths.roomUsersRef(this.rid()).off();
  }

  userDeletedDate(): Promise<number> {
    const ref = this.Paths.roomUsersRef(this.rid()).child(this.UserStore.currentUser().uid());
    return ref.once('value').then((snapshot) => {
      const val = snapshot.val();
      if (val && val.status === UserStatus.Closed) {
        return val.time;
      }
      return null;
    });
  }

  /**
   * Start listening to messages being added
   */

  updateUnreadMessageCounter(messageMeta) {
    if (this.shouldIncrementUnreadMessageBadge() && (messageMeta[MessageKeys.Date] > this.readTimestamp || !this.readTimestamp)) {
      // If this is the first badge then this.badge will
      // undefined - so set it to one
      if (!this.badge) {
        this.badge = 1;
      }
      else {
        this.badge = Math.min(this.badge + 1, 99);
      }
      this.sendBadgeChangedNotification();
    }
  }

  shouldIncrementUnreadMessageBadge() {
    return (!this.active || this.minimized || !this.RoomPositionManager.roomIsOpen(this)); // && !this.isPublic();
  }

  messagesOn(timestamp) {

    // Make sure the room is valid
    if (this.messagesAreOn || !this.rid()) {
      return;
    }
    this.messagesAreOn = true;

    // Also get the messages from the room
    let ref: firebase.database.Query = this.Paths.roomMessagesRef(this.rid());

    let startDate = timestamp;
    if (Utils.unORNull(startDate)) {
      // If we already have a message then only listen for new
      // messages
      const lastMessageTime = this.lastMessageTime();
      if (lastMessageTime) {
        startDate = lastMessageTime + 1;
      }
    }
    else {
      startDate++;
    }

    if (startDate) {
      // Start 1 thousandth of a second after the last message
      // so we don't get a duplicate
      ref = ref.startAt(startDate);
    }
    ref = ref.limitToLast(this.Config.maxHistoricMessages);

    // Add listen to messages added to this thread
    ref.on('child_added', (snapshot) => {

      if (this.Cache.isBlockedUser(snapshot.val()[MessageKeys.UID])) {
        return;
      }

      const message = this.getMessageFromMeta(snapshot.key, snapshot.val());
      this.addMessageToEnd(message);

      // Trim the room to make sure the message count isn't growing
      // out of control
      this.trimMessageList();

      // Is the window visible?
      // Play the sound
      if (!this.muted) {
        if (this.Visibility.getIsHidden()) {
          // Only make a sound for messages that were received less than
          // 30 seconds ago
          if (DEBUG) { console.log('Now: ' + new Date().getTime() + ', Date now: ' + this.Time.now() + ', Message: ' + snapshot.val()[MessageKeys.Date]); }
          if (DEBUG) { console.log('Diff: ' + Math.abs(this.Time.now() - snapshot.val().time)); }
          if (Math.abs(this.Time.now() - snapshot.val()[MessageKeys.Date]) / 1000 < 30) {
            this.SoundEffects.messageReceived();
          }
        }
      }

    });

    ref.on('child_removed', (snapshot) => {
      if (snapshot.val()) {
        for (let i = 0; i < this.messages.length; i++) {
          const message = this.messages[i];
          if (message.mid == snapshot.key) {
            this.messages.splice(i, 1);
            break;
          }
        }
        // this.$rootScope.$broadcast(DeleteMessageNotification, snapshot.val().meta.mid);
        this.update(false);
      }
    });

  }

  trimMessageList() {
    this.sortMessages();
    this.deduplicateMessages();

    const toRemove = this.messages.length - 100;
    if (toRemove > 0) {
      for (let j = 0; j < toRemove; j++) {
        this.messages.shift();

      }
    }
  }

  messagesOff() {

    this.messagesAreOn = false;

    // Get the room meta data
    if (this.rid()) {
      this.Paths.roomMessagesRef(this.rid()).off();
    }
  }

  typingOn() {

    // Handle typing
    const ref = this.Paths.roomTypingRef(this.rid());

    ref.on('child_added', (snapshot) => {
      this.typing[snapshot.key] = snapshot.val().name;

      this.updateTyping();

      // Send a notification to the chat room
      this.$rootScope.$broadcast(N.ChatUpdated, this);
    });

    ref.on('child_removed', (snapshot) => {
      delete this.typing[snapshot.key];

      this.updateTyping();

      // Send a notification to the chat room
      this.$rootScope.$broadcast(N.ChatUpdated, this);
    });

  }

  typingOff() {
    this.Paths.roomTypingRef(this.rid()).off();
  }

  // lastMessageOn() {
  //     let lastMessageRef = this.Paths.roomLastMessageRef(this.rid());
  //     lastMessageRef.on('value', (snapshot) => {
  //         if (snapshot.val()) {
  //
  //             this.setLastMessage(snapshot.val(), );
  //
  //             // If the message comes in then we should make sure
  //             // the room is un deleted
  //             if (!this.Cache.isBlockedUser(this.lastMessage.user.uid())) {
  //                 if (this.deleted) {
  //                     this.deleted = false;
  //                     this.$rootScope.$broadcast(N.RoomAdded, this);
  //                 }
  //             }
  //
  //             this.updateUnreadMessageCounter(this.lastMessage.meta);
  //             this.update(false);
  //
  //         }
  //     });
  // };

  // lastMessageOff() {
  //     this.Paths.roomLastMessageRef(this.rid()).off();
  // };

  /**
   * Remove a public room
   */
  removeFromPublicRooms(): Promise<any> {
    const ref = this.Paths.publicRoomRef(this.getRID());
    return ref.remove();
  }

  userIsMember(user) {
    const userStatus = this.getUserStatus(user);
    return userStatus === UserStatus.Member || userStatus === UserStatus.Owner;
  }

  addUserUpdate(user: IUser, status: UserStatus): {} {
    const update = {};
    const path = this.relativeFirebasePath(this.Paths.roomUsersRef(this.rid()).child(user.uid()).child(UserKeys.Status));
    update[path] = status;
    return update;
  }

  removeUserUpdate(user: IUser): {} {
    const update = {};
    let data = null;
    if (this.getType() === RoomType.OneToOne) {
      data = {};
      data[RoomKeys.Deleted] = database.ServerValue.TIMESTAMP;
      data[RoomKeys.Name] = user.getName();
    }
    update[this.relativeFirebasePath(this.usersRef().child(user.uid()))] = data;
    return update;
  }

  usersRef(): firebase.database.Reference {
    return this.Paths.roomUsersRef(this.rid());
  }

}
