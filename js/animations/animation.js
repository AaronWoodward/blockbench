class Animation {
	constructor(data) {
		this.name = '';
		this.uuid = guid()
		this.loop = 'once';
		this.playing = false;
		this.override = false;
		this.selected = false;
		this.anim_time_update = '';
		this.blend_weight = '';
		this.length = 0;
		this.snapping = settings.animation_snap.value;
		this.animators = {};
		this.markers = [];
		for (var key in Animation.properties) {
			Animation.properties[key].reset(this);
		}
		if (typeof data === 'object') {
			this.extend(data)
		}
	}
	extend(data) {
		for (var key in Animation.properties) {
			Animation.properties[key].merge(this, data)
		}
		Merge.string(this, data, 'name')
		Merge.string(this, data, 'loop', val => ['once', 'loop', 'hold'].includes(val))
		Merge.boolean(this, data, 'override')
		Merge.string(this, data, 'anim_time_update')
		Merge.string(this, data, 'blend_weight')
		Merge.number(this, data, 'length')
		Merge.number(this, data, 'snapping')
		if (typeof data.length == 'number') {
			this.setLength(this.length)
		}
		if (data.bones && !data.animators) {
			data.animators = data.bones;
		}
		if (data.animators instanceof Object) {
			for (var key in data.animators) {
				var group = Group.all.findInArray( isUUID(key) ? 'uuid' : 'name', key )
				if (group) { // todo
					var ba = this.getBoneAnimator(group)
					var kfs = data.animators[key]
					if (kfs && ba) {
						ba.rotation.empty();
						ba.position.empty();
						ba.scale.empty();
						kfs.forEach(kf_data => {
							ba.addKeyframe(kf_data, kf_data.uuid);
						})
					}
				}
			}
		}
		if (data.markers instanceof Array) {
			data.markers.forEach(marker => {
				this.markers.push(new TimelineMarker(marker));
			})
		}
		return this;
	}
	getUndoCopy(options, save) {
		var copy = {
			uuid: this.uuid,
			name: this.name,
			loop: this.loop,
			override: this.override,
			anim_time_update: this.anim_time_update,
			blend_weight: this.blend_weight,
			length: this.length,
			snapping: this.snapping,
			selected: this.selected,
		}
		for (var key in Animation.properties) {
			Animation.properties[key].copy(this, copy)
		}
		if (Object.keys(this.animators).length) {
			copy.animators = {}
			for (var uuid in this.animators) {
				var kfs = this.animators[uuid].keyframes
				if (kfs && kfs.length) {
					if (options && options.bone_names && this.animators[uuid] instanceof BoneAnimator) {
						var group = this.animators[uuid].getGroup();
						uuid = group ? group.name : this.animators[uuid].name;
					}
					copy.animators[uuid] = [];
					kfs.forEach(kf => {
						copy.animators[uuid].push(kf.getUndoCopy(save));
					})
				}
			}
		}
		return copy;
	}
	compileBedrockAnimation() {
		let ani_tag = {};

		if (this.loop == 'hold') {
			ani_tag.loop = 'hold_on_last_frame';
		} else if (this.loop == 'loop' || this.getMaxLength() == 0) {
			ani_tag.loop = true;
		}

		if (this.length) ani_tag.animation_length = this.length;
		if (this.override) ani_tag.override_previous_animation = true;
		if (this.anim_time_update) ani_tag.anim_time_update = this.anim_time_update.replace(/\n/g, '');
		if (this.blend_weight) ani_tag.blend_weight = this.blend_weight.replace(/\n/g, '');
		ani_tag.bones = {};

		for (var uuid in this.animators) {
			var animator = this.animators[uuid];
			if (animator instanceof EffectAnimator) {

				animator.sound.forEach(kf => {
					if (!ani_tag.sound_effects) ani_tag.sound_effects = {};
					ani_tag.sound_effects[kf.getTimecodeString()] = kf.compileBedrockKeyframe();
				})
				animator.particle.forEach(kf => {
					if (!ani_tag.particle_effects) ani_tag.particle_effects = {};
					ani_tag.particle_effects[kf.getTimecodeString()] = kf.compileBedrockKeyframe();
				})
				animator.timeline.forEach(kf => {
					if (!ani_tag.timeline) ani_tag.timeline = {};
					ani_tag.timeline[kf.getTimecodeString()] = kf.compileBedrockKeyframe()
				})

			} else if (animator.keyframes.length) {

				var group = animator.getGroup(); 
				var bone_tag = ani_tag.bones[group ? group.name : animator.name] = {};
				var channels = {};
				//Saving Keyframes
				animator.keyframes.forEach(function(kf) {
					if (!channels[kf.channel]) {
						channels[kf.channel] = {};
					}
					let timecode = kf.getTimecodeString();
					channels[kf.channel][timecode] = kf.compileBedrockKeyframe()
				})
				//Sorting keyframes
				for (var channel in Animator.possible_channels) {
					if (channels[channel]) {
						let timecodes = Object.keys(channels[channel])
						if (timecodes.length === 1) {
							bone_tag[channel] = channels[channel][timecodes[0]]
							if (channel == 'scale' &&
								channels[channel][timecodes[0]] instanceof Array &&
								channels[channel][timecodes[0]].allEqual(channels[channel][timecodes[0]][0])
							) {
								bone_tag[channel] = channels[channel][timecodes[0]][0];
							}
						} else {
							timecodes.sort().forEach((time) => {
								if (!bone_tag[channel]) {
									bone_tag[channel] = {}
								}
								bone_tag[channel][time] = channels[channel][time]
							})
						}
					}
				}
			}
		}
		if (Object.keys(ani_tag.bones).length == 0) {
			delete ani_tag.bones;
		}
		return ani_tag;
	}
	save() {
		let content = {
			format_version: '1.8.0',
			animations: {
				[this.name]: this.compileBedrockAnimation()
			}
		}
		if (isApp && this.path && fs.existsSync(this.path)) {
			//overwrite path

			let data;
			try {
				data = fs.readFileSync(this.path, 'utf-8');
				data = autoParseJSON(data, false);
				if (typeof data.animations !== 'object') {
					throw 'Incompatible format'
				}

			} catch (err) {
				data = null;
				var answer = ElecDialogs.showMessageBox(currentwindow, {
					type: 'warning',
					buttons: [
						tl('message.bedrock_overwrite_error.overwrite'),
						tl('dialog.cancel')
					],
					title: 'Blockbench',
					message: tl('message.bedrock_overwrite_error.message'),
					detail: err+'',
					noLink: false
				})
				if (answer === 1) {
					return;
				}
			}

			if (data) {
				let animation = content.animations[this.name];
				content = data;
				content.animations[this.name] = animation;
			}
			Blockbench.writeFile(this.path, {content: compileJSON(content)}, () => {
				this.saved = true;
			});

		} else {
			//Download
			Blockbench.export({
				resource_id: 'animation',
				type: 'JSON Animation',
				extensions: ['json'],
				name: (Project.geometry_name||'model')+'.animation',
				startpath: this.path,
				content: compileJSON(content),
			}, () => {
				this.saved = true;
			})
		}
		return this;
	}
	select() {
		var scope = this;
		Prop.active_panel = 'animations';
		if (this == Animation.selected) return;
		var selected_bone = Group.selected;
		Animator.animations.forEach(function(a) {
			a.selected = a.playing = false;
		})
		Timeline.animators.purge();
		Timeline.selected.empty();
		Timeline.vue._data.markers = this.markers;
		Timeline.vue._data.animation_length = this.length;
		this.selected = true;
		this.playing = true;
		Animation.selected = this;
		unselectAll();
		BarItems.slider_animation_length.update();

		Group.all.forEach(group => {
			scope.getBoneAnimator(group);
		})

		if (selected_bone) {
			selected_bone.select();
		}
		if (Modes.animate) Animator.preview();
		return this;
	}
	setLength(len) {
		len = limitNumber(len, 0, 1e4)
		this.length = len;
		if (Animation.selected == this) {
			Timeline.vue._data.animation_length = this.length;
			BarItems.slider_animation_length.update()
		}
	}
	createUniqueName(arr) {
		var scope = this;
		var others = Animator.animations;
		if (arr && arr.length) {
			arr.forEach(g => {
				others.safePush(g)
			})
		}
		var name = this.name.replace(/\d+$/, '');
		function check(n) {
			for (var i = 0; i < others.length; i++) {
				if (others[i] !== scope && others[i].name == n) return false;
			}
			return true;
		}
		if (check(this.name)) {
			return this.name;
		}
		for (var num = 2; num < 8e3; num++) {
			if (check(name+num)) {
				scope.name = name+num;
				return scope.name;
			}
		}
		return false;
	}
	rename() {
		var scope = this;
		Blockbench.textPrompt('generic.rename', this.name, function(name) {
			if (name && name !== scope.name) {
				Undo.initEdit({animations: [scope]});
				scope.name = name;
				scope.createUniqueName();
				Undo.finishEdit('rename animation');
			}
		})
		return this;
	}
	editUpdateVariable() {
		var scope = this;
		Blockbench.textPrompt('menu.animation.anim_time_update', scope.anim_time_update, function(value) {
			if (value !== scope.anim_time_update) {
				Undo.initEdit({animations: [scope]})
				scope.anim_time_update = value
				Undo.finishEdit('change animation variable')
			}
		})
		return this;
	}
	editBlendWeight() {
		var scope = this;
		Blockbench.textPrompt('menu.animation.blend_weight', scope.blend_weight, function(value) {
			if (value !== scope.blend_weight) {
				Undo.initEdit({animations: [scope]})
				scope.blend_weight = value
				Undo.finishEdit('change animation blend weight')
			}
		})
		return this;
	}
	togglePlayingState(state) {
		if (!this.selected) {
			this.playing = state !== undefined ? state : !this.playing;
			Animator.preview();
		} else {
			Timeline.start();
		}
		return this.playing;
	}
	showContextMenu(event) {
		this.select();
		this.menu.open(event, this);
		return this;
	}
	getBoneAnimator(group) {
		if (!group && Group.selected) {
			group = Group.selected
		} else if (!group) {
			return;
		}
		var uuid = group.uuid
		if (!this.animators[uuid]) {
			this.animators[uuid] = new BoneAnimator(uuid, this);
		}
		return this.animators[uuid];
	}
	add(undo) {
		if (undo) {
			Undo.initEdit({animations: []})
		}
		if (!Animator.animations.includes(this)) {
			Animator.animations.push(this)
		}
		if (undo) {
			this.select()
			Undo.finishEdit('add animation', {animations: [this]})
		}
		return this;
	}
	remove(undo) {
		if (undo) {
			Undo.initEdit({animations: [this]})
		}
		if (Animation.selected === this) {
			Animation.selected = null
		}
		Animator.animations.remove(this)
		if (undo) {
			Undo.finishEdit('remove animation', {animations: []})

			if (isApp && this.path && fs.existsSync(this.path)) {
				Blockbench.showMessageBox({
					translateKey: 'delete_animation',
					icon: 'movie',
                    buttons: ['generic.delete', 'dialog.cancel']
				}, (result) => {
					if (result == 0) {
						let content = fs.readFileSync(this.path, 'utf-8');
						let json = autoParseJSON(content, false);
						if (json && json.animations && json.animations[this.name]) {
							delete json.animations[this.name];
							Blockbench.writeFile(this.path, {content: compileJSON(json)});
							Undo.history.last().before.animations[this.uuid].saved = false
						}
					}
				})
			}
		}
		Blockbench.dispatchEvent('remove_animation', {animations: [this]})
		return this;
	}
	getMaxLength() {
		var len = this.length||0

		for (var uuid in this.animators) {
			var bone = this.animators[uuid]
			var keyframes = bone.keyframes;
			var i = 0;
			while (i < keyframes.length) {
				len = Math.max(len, keyframes[i].time)
				i++;
			}
		}
		this.setLength(len)
		if (this == Animation.selected) {
			BarItems.slider_animation_length.update()
		}
		return len
	}
	setLoop(value, undo) {
		if ((value == 'once' || value == 'loop' || value == 'hold') && value !== this.loop) {
			if (undo) Undo.initEdit({animations: [this]})
			this.loop = value;
			if (undo) Undo.finishEdit('change animation loop mode')
		}
	}
	calculateSnappingFromKeyframes() {
		let timecodes = [];
		for (var key in this.animators) {
			let animator = this.animators[key];
			animator.keyframes.forEach(kf => {
				timecodes.safePush(kf.time);
			})
		}
		if (timecodes.length > 1) {
			for (var i = 10; i <= 100; i++) {
				let works = true;
				for (var timecode of timecodes) {
					let factor = (timecode * i) % 1;
					if (factor > 0.01 && factor < 0.99) {
						works = false;
						break;
					}
				}
				if (works) {
					this.snapping = i;
					return this.snapping;
				}
			}
		}
	}
	propertiesDialog() {
		let vue_data = {
			anim_time_update: this.anim_time_update,
			blend_weight: this.blend_weight,
		}
		let dialog = new Dialog({
			id: 'animation_properties',
			title: this.name,
			form_first: true,
			form: {
				name: {label: 'generic.name', value: this.name},
				path: {
					label: 'menu.animation.file',
					value: this.path,
					type: 'file',
					extensions: ['json'],
					filetype: 'JSON Animation',
					condition: isApp
				},
				loop: {
					label: 'menu.animation.loop',
					type: 'select',
					value: this.loop,
					options: {
						once: 'menu.animation.loop.once',
						hold: 'menu.animation.loop.hold',
						loop: 'menu.animation.loop.loop',
					},
				},
				override: {label: 'menu.animation.override', type: 'checkbox', value: this.override},
				snapping: {label: 'menu.animation.snapping', type: 'number', value: this.snapping, step: 1, min: 10, max: 100},
				line: '_',
			},
			lines: [
				`<div id="animation_properties_vue">
					<label>${tl('menu.animation.anim_time_update')}</label>
					<div class="dialog_bar">
						<vue-prism-editor class="molang_input dark_bordered" v-model="anim_time_update" language="molang" :line-numbers="false" />
					</div>
					<label>${tl('menu.animation.blend_weight')}</label>
					<div class="dialog_bar">
						<vue-prism-editor class="molang_input dark_bordered" v-model="blend_weight" language="molang" :line-numbers="false" />
					</div>
				</div>`
			],
			onConfirm: form_data => {
				console.log(form_data, vue_data)
				dialog.hide()
				if (
					form_data.loop != this.loop
					|| form_data.name != this.name
					|| (isApp && form_data.path != this.path)
					|| form_data.loop != this.loop
					|| form_data.override != this.override
					|| form_data.snapping != this.snapping
					|| vue_data.anim_time_update != this.anim_time_update
					|| vue_data.blend_weight != this.blend_weight
				) {
					Undo.initEdit({animations: [this]});
					this.loop = form_data.loop;
					this.name = form_data.name;
					if (isApp) this.path = form_data.path;
					this.loop = form_data.loop;
					this.override = form_data.override;
					this.snapping = Math.clamp(form_data.snapping, 10, 100);
					this.anim_time_update = vue_data.anim_time_update;
					this.blend_weight = vue_data.blend_weight;
					Undo.finishEdit('edit animation properties');
				}
			}
		})
		dialog.show();
		new Vue({
			el: 'dialog#animation_properties #animation_properties_vue',
			components: {VuePrismEditor},
			data: vue_data
		})
	}
}
	Animation.all = [];
	Animation.selected = null;
	Animation.prototype.menu = new Menu([
		{name: 'menu.animation.loop', icon: 'loop', children: [
			{name: 'menu.animation.loop.once', icon: animation => (animation.loop == 'once' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) {animation.setLoop('once', true)}},
			{name: 'menu.animation.loop.hold', icon: animation => (animation.loop == 'hold' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) {animation.setLoop('hold', true)}},
			{name: 'menu.animation.loop.loop', icon: animation => (animation.loop == 'loop' ? 'radio_button_checked' : 'radio_button_unchecked'), click(animation) {animation.setLoop('loop', true)}},
		]},
		'_',
		{
			name: 'menu.animation.save',
			id: 'save',
			icon: 'save',
			click(animation) {
				animation.save();
			}
		},
		{
			name: 'menu.animation.open_location',
			id: 'open_location',
			icon: 'folder',
			condition(animation) {return isApp && animation.path && fs.existsSync(animation.path)},
			click(animation) {
				shell.showItemInFolder(animation.path);
			}
		},
		'duplicate',
		'delete',
		'_',
		{name: 'menu.animation.properties', icon: 'list', click: function(animation) {
			animation.propertiesDialog();
		}}
	])
	new Property(Animation, 'boolean', 'saved', {default: true})
	new Property(Animation, 'string', 'path')

Blockbench.on('finish_edit', event => {
	if (event.aspects.animations && event.aspects.animations.length) {
		event.aspects.animations.forEach(animation => {
			animation.saved = false;
		})
	}
	if (event.aspects.keyframes && event.aspects.keyframes.length) {
		event.aspects.keyframes.forEach(kf => {
			if (kf.animator && kf.animator.animation) {
				kf.animator.animation.saved = false;
			}
		})
	}
})

class GeneralAnimator {
	constructor(uuid, animation) {
		this.animation = animation;
		this.expanded = false;
		this.selected = false;
		this.uuid = uuid || guid();
		this.muted = {};
		this.channels.forEach(channel => {
			this.muted[channel] = false;
		})
	}
	select() {
		var scope = this;
		TickUpdates.keyframes = true;
		for (var key in Animation.selected.animators) {
			Animation.selected.animators[key].selected = false;
		}
		this.selected = true;
		Timeline.selected_animator = this;
		this.addToTimeline();
		Vue.nextTick(() => {
			scope.scrollTo();
		})
		return this;
	}
	addToTimeline() {
		if (!Timeline.animators.includes(this)) {
			Timeline.animators.splice(0, 0, this);
		}
		if (!this.expanded) this.expanded = true;
		return this;
	}
	addKeyframe(data, uuid) {
		var channel = data.channel;
		if (typeof channel == 'number') channel = this.channels[channel];
		if (channel && this[channel]) {
			var kf = new Keyframe(data, uuid);
			this[channel].push(kf);
			kf.animator = this;
			return kf;
		}
	}
	createKeyframe(value, time, channel, undo, select) {
		if (!this[channel]) return;
		var keyframes = [];
		if (undo) {
			Undo.initEdit({keyframes})
		}
		var keyframe = new Keyframe({
			channel: channel,
			time: time
		});
		keyframes.push(keyframe);

		if (value) {
			keyframe.extend(value);
		} else if (this.fillValues) {
			this.fillValues(keyframe, value, true);
		}
		keyframe.channel = channel;
		keyframe.time = time;

		this[channel].push(keyframe);
		keyframe.animator = this;

		if (select !== false) {
			keyframe.select();
		}
		TickUpdates.keyframes = true;

		var deleted = [];
		delete keyframe.time_before;
		keyframe.replaceOthers(deleted);
		Undo.addKeyframeCasualties(deleted);

		if (undo) {
			Undo.finishEdit('added keyframe')
		}
		return keyframe;
	}
	getOrMakeKeyframe(channel) {
		var before, result;

		for (var kf of this[channel]) {
			if (Math.abs(kf.time - Timeline.time) < 0.02) {
				before = kf;
			}
		}
		result = before ? before : this.createKeyframe(null, Timeline.time, channel, false, false);
		return {before, result};
	}
	toggleMuted(channel) {
		this.muted[channel] = !this.muted[channel];
	}
	scrollTo() {
		var el = $(`#timeline_body_inner > li[uuid=${this.uuid}]`).get(0)
		if (el) {
			var offset = el.offsetTop;
			var timeline = $('#timeline_body').scrollTop();
			var height = $('#timeline_body').height();
			if (offset < timeline) {
				$('#timeline_body').animate({
					scrollTop: offset
				}, 200);
			}
			if (offset + el.clientHeight > timeline + height) {
				$('#timeline_body').animate({
					scrollTop: offset - (height-el.clientHeight-20)
				}, 200);
			}
		}
	}
}
class BoneAnimator extends GeneralAnimator {
	constructor(uuid, animation, name) {
		super(uuid, animation);
		this.uuid = uuid;
		this._name = name;

		this.rotation = [];
		this.position = [];
		this.scale = [];
	}
	get name() {
		var group = this.getGroup();
		if (group) return group.name;
		return this._name;
	}
	set name(name) {
		this._name = name;
	}
	get keyframes() {
		return [...this.rotation, ...this.position, ...this.scale];
	}
	getGroup() {
		this.group = Group.all.findInArray('uuid', this.uuid)
		if (!this.group) {
			if (this.animation && this.animation.animators[this.uuid] && this.animation.animators[this.uuid].type == 'bone') {
				delete this.animation.bones[this.uuid];
			}
		}
		return this.group
	}
	select(group_is_selected) {
		if (this.getGroup().locked) return this;

		var duplicates;
		for (var key in this.animation.animators) {
			this.animation.animators[key].selected = false;
		}
		if (group_is_selected !== true) {
			this.group.select();
		}
		function iterate(arr) {
			arr.forEach((it) => {
				if (it.type === 'group' && !duplicates) {
					if (it.name === Group.selected.name && it !== Group.selected) {
						duplicates = true;
					} else if (it.children && it.children.length) {
						iterate(it.children);
					}
				}
			})
		}
		iterate(Outliner.root);
		if (duplicates) {
			Blockbench.showMessageBox({
				translateKey: 'duplicate_groups',
				icon: 'folder',
				buttons: ['dialog.ok'],
			});
		}
		super.select();
		
		if (this[Toolbox.selected.animation_channel] && (Timeline.selected.length == 0 || Timeline.selected[0].animator != this)) {
			var nearest;
			this[Toolbox.selected.animation_channel].forEach(kf => {
				if (Math.abs(kf.time - Timeline.time) < 0.002) {
					nearest = kf;
				}
			})
			if (nearest) {
				nearest.select();
			}
		}

		if (this.group && this.group.parent && this.group.parent !== 'root') {
			this.group.parent.openUp();
		}
		return this;
	}
	fillValues(keyframe, values, allow_expression) {

		if (values instanceof Array) {
			keyframe.extend({
				x: values[0],
				y: values[1],
				z: values[2]
			})
			if (values[3]) {
				keyframe.extend({w: values[3], isQuaternion: true})
			}
		} else if (typeof values === 'number' || typeof values === 'string') {
			keyframe.extend({
				x: values,
				y: values,
				z: values
			})
		} else if (values == null) {
			var ref = this.interpolate(keyframe.channel, allow_expression)
			if (ref) {
				let e = 1e2
				ref.forEach((r, i) => {
					if (!isNaN(r)) {
						ref[i] = Math.round(parseFloat(r)*e)/e
					}
				})
				keyframe.extend({
					x: ref[0],
					y: ref[1],
					z: ref[2],
					w: ref.length === 4 ? ref[3] : undefined,
					isQuaternion: ref.length === 4
				})
			}
		} else {
			keyframe.extend(values)
		}
	}
	pushKeyframe(keyframe) {
		this[keyframe.channel].push(keyframe)
		keyframe.animator = this;
		return this;
	}
	doRender() {
		this.getGroup()
		if (this.group && this.group.children && this.group.mesh) {
			let mesh = this.group.mesh
			return (mesh && mesh.fix_rotation)
		}
	}
	displayRotation(arr, multiplier) {
		var bone = this.group.mesh

		if (!arr) {
		} else if (arr.length === 4) {
			var added_rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(arr), 'ZYX')
			bone.rotation.x -= added_rotation.x * multiplier
			bone.rotation.y -= added_rotation.y * multiplier
			bone.rotation.z += added_rotation.z * multiplier
		} else {
			arr.forEach((n, i) => {
				bone.rotation[getAxisLetter(i)] += Math.degToRad(n) * (i == 2 ? 1 : -1) * multiplier
			})
		}
		return this;
	}
	displayPosition(arr, multiplier) {
		var bone = this.group.mesh
		if (arr) {
			bone.position.x -= arr[0] * multiplier;
			bone.position.y += arr[1] * multiplier;
			bone.position.z += arr[2] * multiplier;
		}
		return this;
	}
	displayScale(arr, multiplier) {
		if (!arr) return this;
		var bone = this.group.mesh;
		bone.scale.x *= (1 + (arr[0] - 1) * multiplier) || 0.00001;
		bone.scale.y *= (1 + (arr[1] - 1) * multiplier) || 0.00001;
		bone.scale.z *= (1 + (arr[2] - 1) * multiplier) || 0.00001;
		return this;
	}
	interpolate(channel, allow_expression) {
		let time = Timeline.time;
		var i = 0;
		var before = false
		var after = false
		var result = false
		for (var keyframe of this[channel]) {

			if (keyframe.time < time) {
				if (!before || keyframe.time > before.time) {
					before = keyframe
				}
			} else  {
				if (!after || keyframe.time < after.time) {
					after = keyframe
				}
			}
			i++;
		}
		if (before && Math.abs(before.time - time) < 1/1200) {
			result = before
		} else if (after && Math.abs(after.time - time) < 1/1200) {
			result = after
		} else if (before && !after) {
			result = before
		} else if (after && !before) {
			result = after
		} else if (!before && !after) {
			//
		} else {
			let alpha = Math.lerp(before.time, after.time, time)
			if (Blockbench.hasFlag('no_interpolations')) {
				alpha = Math.round(alpha)
			}
			result = [
				before.getLerp(after, 'x', alpha, allow_expression),
				before.getLerp(after, 'y', alpha, allow_expression),
				before.getLerp(after, 'z', alpha, allow_expression)
			]
			if (before.isQuaternion && after.isQuaternion) {
				result[3] = before.getLerp(after, 'q', alpha, allow_expression)
			}
		}
		if (result && result.type === 'keyframe') {
			let keyframe = result
			let method = allow_expression ? 'get' : 'calc'
			result = [
				keyframe[method]('x'),
				keyframe[method]('y'),
				keyframe[method]('z')
			]
			if (keyframe.isQuaternion)	 	{
				result[3] = keyframe[method]('w')
			}
		}
		return result
	}
	displayFrame(multiplier = 1) {
		if (!this.doRender()) return;
		this.getGroup()

		if (!this.muted.rotation) this.displayRotation(this.interpolate('rotation'), multiplier)
		if (!this.muted.position) this.displayPosition(this.interpolate('position'), multiplier)
		if (!this.muted.scale) this.displayScale(this.interpolate('scale'), multiplier)
	}
}
	BoneAnimator.prototype.channels = ['rotation', 'position', 'scale']
class EffectAnimator extends GeneralAnimator {
	constructor(animation) {
		super(null, animation);

		this.name = tl('timeline.effects')
		this.selected = false;

		this.particle = [];
		this.sound = [];
		this.timeline = [];
	}
	get keyframes() {
		return [...this.particle, ...this.sound, ...this.timeline];
	}
	pushKeyframe(keyframe) {
		this[keyframe.channel].push(keyframe)
		keyframe.animator = this;
		return this;
	}
	displayFrame() {
		if (!this.muted.sound) {
			this.sound.forEach(kf => {
				var diff = kf.time - Timeline.time;
				if (diff >= 0 && diff < (1/60) * (Timeline.playback_speed/100)) {
					if (kf.file && !kf.cooldown) {
						 var media = new Audio(kf.file);
						 window._media = media
						 media.volume = Math.clamp(settings.volume.value/100, 0, 1);
						 media.play();
						 Timeline.playing_sounds.push(media);
						 media.onended = function() {
						 	Timeline.playing_sounds.remove(media);
						 }

						 kf.cooldown = true;
						 setTimeout(() => {
						 	delete kf.cooldown;
						 }, 400)
					} 
				}
			})
		}
	}
	startPreviousSounds() {
		if (!this.muted.sound) {
			this.sound.forEach(kf => {
				if (kf.file && !kf.cooldown) {
					var diff = kf.time - Timeline.time;
					if (diff < 0 && Timeline.waveforms[kf.file] && Timeline.waveforms[kf.file].duration > -diff) {
						var media = new Audio(kf.file);
						window._media = media
						media.volume = Math.clamp(settings.volume.value/100, 0, 1);
						media.currentTime = -diff;
						media.play();
						Timeline.playing_sounds.push(media);
						media.onended = function() {
							Timeline.playing_sounds.remove(media);
						}

						kf.cooldown = true;
						setTimeout(() => {
							delete kf.cooldown;
						}, 400)
					} 
				}
			})
		}
	}
}
	EffectAnimator.prototype.channels = ['particle', 'sound', 'timeline']

//Clipbench
Object.assign(Clipbench, {
	setKeyframes() {

		var keyframes = Timeline.selected;

		Clipbench.keyframes = []
		if (!keyframes || keyframes.length === 0) {
			return;
		}
		var first = keyframes[0];
		var single_animator;
		keyframes.forEach(function(kf) {
			if (kf.time < first.time) {
				first = kf
			}
			if (single_animator && single_animator !== kf.animator.uuid) {
				single_animator = false;
			} else if (single_animator == undefined) {
				single_animator = kf.animator.uuid;
			}
		})

		keyframes.forEach(function(kf) {
			var copy = kf.getUndoCopy();
			copy.time_offset = kf.time - first.time;
			if (single_animator != false) {
				delete copy.animator;
			}
			Clipbench.keyframes.push(copy)
		})
		if (isApp) {
			clipboard.writeHTML(JSON.stringify({type: 'keyframes', content: Clipbench.keyframes}))
		}
	},
	pasteKeyframes() {
		if (isApp) {
			var raw = clipboard.readHTML()
			try {
				var data = JSON.parse(raw)
				if (data.type === 'keyframes' && data.content) {
					Clipbench.keyframes = data.content
				}
			} catch (err) {}
		}
		if (Clipbench.keyframes && Clipbench.keyframes.length) {

			if (!Animation.selected) return;
			var keyframes = [];
			Undo.initEdit({keyframes});
			Timeline.selected.empty();
			Timeline.keyframes.forEach((kf) => {
				kf.selected = false;
			})
			Clipbench.keyframes.forEach(function(data, i) {

				if (data.animator) {
					var animator = Animation.selected.animators[data.animator];
					if (animator && !Timeline.animators.includes(animator)) {
						animator.addToTimeline();
					}
				} else {
					var animator = Timeline.selected_animator;
				}
				if (animator) {
					var kf = animator.createKeyframe(data, Timeline.time + data.time_offset, data.channel, false, false)
					if (!kf) return;
					keyframes.push(kf);
					kf.selected = true;
					Timeline.selected.push(kf);
				}

			})
			TickUpdates.keyframe_selection = true;
			Animator.preview()
			Undo.finishEdit('paste keyframes');
		}
	}
})

const Animator = {
	possible_channels: {rotation: true, position: true, scale: true, sound: true, particle: true, timeline: true},
	open: false,
	animations: Animation.all,
	get selected() {return Animation.selected},
	frame: 0,
	interval: false,
	join() {

		Animator.open = true;
		selected.empty()
		Canvas.updateAllBones()

		$('body').addClass('animation_mode')
		if (!Animator.timeline_node) {
			Animator.timeline_node = $('#timeline').get(0)
		}
		updateInterface()
		Toolbars.element_origin.toPlace('bone_origin')
		if (!Timeline.is_setup) {
			Timeline.setup()
		}
		TickUpdates.keyframes = true;
		if (outlines.children.length) {
			outlines.children.empty()
			Canvas.updateAllPositions()
		}
		if (!Animation.selected && Animator.animations.length) {
			Animator.animations[0].select()
		}
		Animator.preview()
	},
	leave() {
		Timeline.pause()
		Animator.open = false;
		$('body').removeClass('animation_mode')
		//resizeWindow()
		//updateInterface()
		Toolbars.element_origin.toPlace()
		//if (quad_previews.enabled_before) {
		//	openQuadView()
		//}
		Canvas.updateAllBones()
	},
	showDefaultPose(no_matrix_update) {
		Group.all.forEach(group => {
			var bone = group.mesh;
			bone.rotation.copy(bone.fix_rotation)
			bone.position.copy(bone.fix_position)
			bone.scale.x = bone.scale.y = bone.scale.z = 1;

			if (!no_matrix_update) group.mesh.updateMatrixWorld()
		})
	},
	preview() {
		// Bones
		Animator.showDefaultPose(true);
		Group.all.forEach(group => {
			Animator.animations.forEach(animation => {
				let multiplier = animation.blend_weight ? Math.clamp(Molang.parse(animation.blend_weight), 0, Infinity) : 1;
				if (animation.playing) {
					animation.getBoneAnimator(group).displayFrame(multiplier)
				}
			})
			group.mesh.updateMatrixWorld()
		})

		// Effects
		Animator.animations.forEach(animation => {
			if (animation.playing) {
				if (animation.animators.effects) {
					animation.animators.effects.displayFrame();
				}
			}
		})

		if (Group.selected) {
			Transformer.center()
		}
		Blockbench.dispatchEvent('display_animation_frame')
	},
	loadFile(file, animation_filter) {
		var json = file.json || autoParseJSON(file.content);
		let path = file.path;
		let new_animations = [];
		if (json && typeof json.animations === 'object') {
			for (var ani_name in json.animations) {
				if (animation_filter && !animation_filter.includes(ani_name)) continue;
				//Animation
				var a = json.animations[ani_name]
				var animation = new Animation({
					name: ani_name,
					path,
					loop: a.loop && (a.loop == 'hold_on_last_frame' ? 'hold' : 'loop'),
					override: a.override_previous_animation,
					anim_time_update: (typeof a.anim_time_update == 'string'
						? a.anim_time_update.replace(/;(?!$)/, ';\n')
						: a.anim_time_update),
					blend_weight: (typeof a.blend_weight == 'string'
						? a.blend_weight.replace(/;(?!$)/, ';\n')
						: a.blend_weight),
					length: a.animation_length
				}).add()
				//Bones
				if (a.bones) {
					function getKeyframeDataPoints(source) {
						if (source instanceof Array) {
							return [{
								x: source[0],
								y: source[1],
								z: source[2],
							}]
						} else if (['number', 'string'].includes(typeof source)) {
							return [{
								x: source, y: source, z: source
							}]
						} else if (typeof source == 'object') {
							let points = [];
							if (source.pre) {
								points.push(getKeyframeDataPoints(source.pre)[0])
							}
							if (source.post) {
								points.push(getKeyframeDataPoints(source.post)[0])
							}
							return points;
						}
					}
					for (var bone_name in a.bones) {
						var b = a.bones[bone_name]
						let lowercase_bone_name = bone_name.toLowerCase();
						var group = Group.all.find(group => group.name.toLowerCase() == lowercase_bone_name)
						let uuid = group ? group.uuid : guid();

						var ba = new BoneAnimator(uuid, animation, bone_name);
						animation.animators[uuid] = ba;
						//Channels
						for (var channel in b) {
							if (Animator.possible_channels[channel]) {
								if (typeof b[channel] === 'string' || typeof b[channel] === 'number' || b[channel] instanceof Array) {
									ba.addKeyframe({
										time: 0,
										channel,
										data_points: getKeyframeDataPoints(b[channel]),
									})
								} else if (typeof b[channel] === 'object') {
									for (var timestamp in b[channel]) {
										ba.addKeyframe({
											time: parseFloat(timestamp),
											channel,
											data_points: getKeyframeDataPoints(b[channel][timestamp]),
										});
									}
								}
							}
						}
					}
				}
				if (a.sound_effects) {
					if (!animation.animators.effects) {
						animation.animators.effects = new EffectAnimator(animation);
					}
					for (var timestamp in a.sound_effects) {
						var sounds = a.sound_effects[timestamp];
						if (sounds instanceof Array === false) sounds = [sounds];
						animation.animators.effects.addKeyframe({
							channel: 'sound',
							time: parseFloat(timestamp),
							data_points: sounds
						})
					}
				}
				if (a.particle_effects) {
					if (!animation.animators.effects) {
						animation.animators.effects = new EffectAnimator(animation);
					}
					for (var timestamp in a.particle_effects) {
						var particles = a.particle_effects[timestamp];
						if (particles instanceof Array === false) particles = [particles];
						particles.forEach(particle => {
							if (particle) particle.script = particle.pre_effect_script;
						})
						animation.animators.effects.addKeyframe({
							channel: 'particle',
							time: parseFloat(timestamp),
							data_points: particles
						})
					}
				}
				if (a.timeline) {
					if (!animation.animators.effects) {
						animation.animators.effects = new EffectAnimator(animation);
					}
					for (var timestamp in a.timeline) {
						var entry = a.timeline[timestamp];
						var instructions = entry instanceof Array ? entry.join('\n') : entry;
						animation.animators.effects.addKeyframe({
							channel: 'timeline',
							time: parseFloat(timestamp),
							data_points: [{instructions}]
						})
					}
				}
				animation.calculateSnappingFromKeyframes();
				if (!Animation.selected) {
					animation.select()
				}
				new_animations.push(animation)
			}
		}
		return new_animations
	},
	buildFile(options) {
		if (typeof options !== 'object') {
			options = false
		}
		var animations = {}
		Animator.animations.forEach(function(a) {
			let ani_tag = a.compileBedrockAnimation();
			animations[a.name] = ani_tag;
		})
		return {
			format_version: '1.8.0',
			animations: animations
		}
	},
	importFile(file) {
		let form = {};
		let json = autoParseJSON(file.content)
		for (var key in json.animations) {
			form[key.hashCode()] = {label: key, type: 'checkbox', value: true}
		}
		file.json = json;
		if (Object.keys(json.animations) <= 1) {
			Undo.initEdit({animations: []})
			let new_animations = Animator.loadFile(file);
			Undo.finishEdit('import animations', {animations: new_animations})
			return;
		}
		console.log(form)
		let dialog = new Dialog({
			id: 'animation_import',
			title: 'dialog.animation_import.title',
			form,
			onConfirm(form_result) {
				dialog.hide();
				let names = [];
				for (var key in json.animations) {
					if (form_result[key.hashCode()]) {
						names.push(key);
					}
				}
				Undo.initEdit({animations: []})
				let new_animations = Animator.loadFile(file, names);
				Undo.finishEdit('import animations', {animations: new_animations})
			}
		})
		dialog.show();
	}
}

Molang.global_variables = {
	'true': 1,
	'false': 0,
	get 'query.delta_time'() {
		let timecode = new Date().getMilliseconds();
		let time = (timecode - Timeline.last_frame_timecode + 1) / 1000;
		if (time < 0) time += 1;
		return time;
	},
	get 'query.anim_time'() {
		return Timeline.time;
	},
	get 'query.life_time'() {
		return Timeline.time;
	},
	get 'time'() {
		return Timeline.time;
	}
}
Molang.variableHandler = function (variable) {
	var inputs = Interface.Panels.variable_placeholders.inside_vue._data.text.split('\n');
	var i = 0;
	while (i < inputs.length) {
		let key, val;
		[key, val] = inputs[i].split(/=(.+)/);
		key = key.replace(/[\s;]/g, '');
		if (key === variable) {
			return Molang.parse(val)
		}
		i++;
	}
}

Blockbench.addDragHandler('animation', {
	extensions: ['animation.json'],
	readtype: 'text',
	condition: {modes: ['animate']},
}, function(files) {
	console.log(files)
	Animator.importFile(files[0])
})

BARS.defineActions(function() {
	new Action('add_animation', {
		icon: 'fa-plus-circle',
		category: 'animation',
		condition: {modes: ['animate']},
		click: function () {
			new Animation({
				name: 'animation.' + (Project.geometry_name||'model') + '.new'
			}).add(true).propertiesDialog()

		}
	})
	new Action('load_animation_file', {
		icon: 'fa-file-video',
		category: 'animation',
		condition: {modes: ['animate']},
		click: function () {
			var path = ModelMeta.export_path
			if (isApp) {
				var exp = new RegExp(osfs.replace('\\', '\\\\')+'models'+osfs.replace('\\', '\\\\'))
				var m_index = path.search(exp)
				if (m_index > 3) {
					path = path.substr(0, m_index) + osfs + 'animations' + osfs + pathToName(ModelMeta.export_path).replace(/\.geo/, '.animation')
				}
			}
			Blockbench.import({
				resource_id: 'animation',
				extensions: ['json'],
				type: 'JSON Animation',
				startpath: path
			}, function(files) {
				Animator.importFile(files[0])
			})
		}
	})
	new Action('export_animation_file', {
		icon: 'save',
		category: 'animation',
		click: function () {
			var content = autoStringify(Animator.buildFile())
			var path = ModelMeta.animation_path

			if (isApp && !path) {
				path = ModelMeta.export_path
				var exp = new RegExp(osfs.replace('\\', '\\\\')+'models'+osfs.replace('\\', '\\\\'))
				var m_index = path.search(exp)
				if (m_index > 3) {
					path = path.substr(0, m_index) + osfs + 'animations' + osfs +  pathToName(ModelMeta.export_path, true)
				}
				if (path.match(/\.geo\.json$/)) {
					path = path.replace(/\.geo\.json$/, '.animation.json')
				} else {
					path = path.replace(/\.json$/, '.animation.json')
				}
			}
			Blockbench.export({
				resource_id: 'animation',
				type: 'JSON Animation',
				extensions: ['json'],
				name: (Project.geometry_name||'model')+'.animation',
				startpath: path,
				content: content,
			}, (real_path) => {
				ModelMeta.animation_path = real_path;
			})

		}
	})

	/*
	//Inverse Kinematics
	new Action('ik_enabled', {
		icon: 'check_box_outline_blank',
		category: 'animation',
		click: function () {
			Group.selected.ik_enabled = !Group.selected.ik_enabled;
			updateNslideValues();
			Transformer.updateSelection();
		}
	})
	new NumSlider('slider_ik_chain_length', {
		category: 'animation',
		condition: () => Animator.open && Group.selected,
		get: function() {
			return Group.selected.ik_chain_length||0;
		},
		settings: {
			min: 0, max: 64, default: 0,
			interval: function(event) {
				return 1;
			}
		},
		change: function(modify) {
			Group.selected.ik_chain_length = modify(Group.selected.ik_chain_length);
		},
		onBefore: function() {
			Undo.initEdit({keyframes: Timeline.selected})
		},
		onAfter: function() {
			Undo.finishEdit('move keyframes')
		}
	})*/

})

Interface.definePanels(function() {

	Interface.Panels.animations = new Panel({
		id: 'animations',
		icon: 'movie',
		condition: {modes: ['animate']},
		toolbars: {
			head: Toolbars.animations
		},
		component: {
			name: 'panel-animations',
			data() { return {
				animations: Animator.animations,
				files_folded: {}
			}},
			methods: {
				toggle(key) {
					this.files_folded[key] = !this.files_folded[key];
					this.$forceUpdate();
				},
				saveFile(key, file) {
					if (key && isApp) {
						file.animations.forEach(animation => {
							animation.save();
						})
					} else {
						
					}
				},
				addAnimation(path) {
					let other_animation = Animation.all.find(a => a.path == path)
					new Animation({
						name: other_animation && other_animation.name.replace(/\w+$/, 'new'),
						path
					}).add(true).propertiesDialog()
				}
			},
			computed: {
				files() {
					let files = {};
					this.animations.forEach(animation => {
						let key = animation.path || '';
						if (!files[key]) files[key] = {
							animations: [],
							name: animation.path ? pathToName(animation.path, true) : 'Unsaved',
							saved: true
						};
						if (!animation.saved) files[key].saved = false;
						files[key].animations.push(animation);
					})
					return files;
				}
			},
			template: `
				<div>
					<div class="toolbar_wrapper animations"></div>
					<ul id="animations_list" class="list">
						<li v-for="(file, key) in files" :key="key" class="animation_file">
							<div class="animation_file_head" v-on:click.stop="toggle(key)">
								<i v-on:click.stop="toggle(key)" class="icon-open-state fa" :class=\'{"fa-angle-right": files_folded[key], "fa-angle-down": !files_folded[key]}\'></i>
								<label>{{ file.name }}</label>
								<div class="in_list_button" v-if="!file.saved" v-on:click.stop="saveFile(key, file)">
									<i class="material-icons">save</i>
								</div>
								<div class="in_list_button" v-on:click.stop="addAnimation(key)">
									<i class="material-icons">add</i>
								</div>
							</div>
							<ul v-if="!files_folded[key]">	
								<li
									v-for="animation in file.animations"
									v-bind:class="{ selected: animation.selected }"
									v-bind:anim_id="animation.uuid"
									class="animation"
									v-on:click.stop="animation.select()"
									v-on:dblclick.stop="animation.propertiesDialog()"
									:key="animation.uuid"
									@contextmenu.prevent.stop="animation.showContextMenu($event)"
								>
									<i class="material-icons">movie</i>
									<label>{{ animation.name }}</label>
									<div class="in_list_button" v-bind:class="{unclickable: animation.saved}" v-on:click.stop="animation.save()">
										<i v-if="animation.saved" class="material-icons">check_circle</i>
										<i v-else class="material-icons">save</i>
									</div>
									<div class="in_list_button" v-on:click.stop="animation.togglePlayingState()">
										<i v-if="animation.playing" class="fa_big far fa-play-circle"></i>
										<i v-else class="fa_big far fa-circle"></i>
									</div>
								</li>
							</ul>
						</li>
					</ul>
				</div>
			`
		}
	})

	Interface.Panels.variable_placeholders = new Panel({
		id: 'variable_placeholders',
		icon: 'fas.fa-stream',
		condition: {modes: ['animate']},
		growable: true,
		toolbars: {
		},
		component: {
			name: 'panel-placeholders',
			components: {VuePrismEditor},
			data() { return {
				text: ''
			}},
			template: `
				<div style="flex-grow: 1; display: flex; flex-direction: column;">
					<p>{{ tl('panel.variable_placeholders.info') }}</p>
					<vue-prism-editor
						id="var_placeholder_area"
						class="molang_input dark_bordered tab_target"
						v-model="text"
						language="molang"
						:line-numbers="false"
						style="flex-grow: 1;"
						onkeyup="Animator.preview()"
					/>
				</div>
			`
		}
	})
})