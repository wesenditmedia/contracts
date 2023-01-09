// SPDX-License-Identifier: MIT
// Based on https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/extensions/ERC20Snapshot.sol
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "hardhat/console.sol";

/**
 * Snapshot object structure
 */
struct Snapshots {
    // Snapshot ids
    uint256[] ids;
    // Snapshot values
    uint256[] values;
}

// TODO: add comments
abstract contract StakingPoolSnapshot {
    using Arrays for uint256[];
    using Counters for Counters.Counter;

    // Snapshots for _accRewardsPerShare
    Snapshots internal _accRewardsPerShareSnapshots;

    // Snapshots for _currentPoolFactor
    Snapshots internal _currentPoolFactorSnapshots;

    // Snapshots for _lastRewardTimestamp
    Snapshots internal _lastRewardTimestampSnapshots;

    // Current snapshot id
    Counters.Counter private _currentSnapshotId;

    function _accRewardsPerShareAt(
        uint256 snapshotId,
        uint256 currentValue
    ) internal view virtual returns (uint256, uint256) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _accRewardsPerShareSnapshots
        );

        return (id, snapshotted ? value : currentValue);
    }

    function _currentPoolFactorAt(
        uint256 snapshotId,
        uint256 currentValue
    ) internal view virtual returns (uint256, uint256) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _currentPoolFactorSnapshots
        );

        return (id, snapshotted ? value : currentValue);
    }

    function _lastRewardTimestampAt(
        uint256 snapshotId,
        uint256 currentValue
    ) internal view virtual returns (uint256, uint256) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _lastRewardTimestampSnapshots
        );

        return (id, snapshotted ? value : currentValue);
    }

    function _snapshot() internal virtual returns (uint256) {
        _currentSnapshotId.increment();

        uint256 currentId = _getCurrentSnapshotId();
        return currentId;
    }

    function _getCurrentSnapshotId() internal view virtual returns (uint256) {
        return block.timestamp;
    }

    function _updateSnapshot(
        Snapshots storage snapshots,
        uint256 currentValue
    ) internal {
        uint256 currentId = _getCurrentSnapshotId();
        if (_lastSnapshotId(snapshots.ids) < currentId) {
            snapshots.ids.push(currentId);
            snapshots.values.push(currentValue);
        }
    }

    function _lastSnapshotId(
        uint256[] storage ids
    ) private view returns (uint256) {
        if (ids.length == 0) {
            return 0;
        } else {
            return ids[ids.length - 1];
        }
    }

    function _valueAt(
        uint256 snapshotId,
        Snapshots storage snapshots
    ) private view returns (bool, uint256, uint256) {
        require(snapshotId > 0, "Staking Pool Snapshot: id is 0");
        require(
            snapshotId <= _getCurrentSnapshotId(),
            "Staking Pool Snapshot: nonexistent id"
        );

        uint256 index = snapshots.ids.findUpperBound(snapshotId);

        if (index == snapshots.ids.length) {
            return (false, 0, 0);
        } else {
            return (true, snapshots.ids[index], snapshots.values[index]);
        }
    }
}
