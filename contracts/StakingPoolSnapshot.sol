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

abstract contract StakingPoolSnapshot {
    using Arrays for uint256[];
    using Counters for Counters.Counter;

    // Snapshots for _accRewardsPerShare
    Snapshots internal _accRewardsPerShareSnapshots;

    // Snapshots for _lastRewardTimestamp
    Snapshots internal _lastRewardTimestampSnapshots;

    // Current snapshot id
    Counters.Counter private _currentSnapshotId;

    /**
     * Returns accRewardsPerShare at best matching snapshot
     *
     * @param snapshotId uint256 - Snapshot ID / block timestamp to look for
     * @param currentValue uint256 - Current value used as fallback
     *
     * @return snapshotId_ uint256 - Best matching snapshot ID
     * @return snapshotValue uint256 - Value at the snapshot or fallback value, if no snapshot was found
     */
    function _accRewardsPerShareAt(
        uint256 snapshotId,
        uint256 currentValue
    ) internal view returns (uint256 snapshotId_, uint256 snapshotValue) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _accRewardsPerShareSnapshots
        );

        return (id, snapshotted ? value : currentValue);
    }

    /**
     * Returns lastRewardTimestamp at best matching snapshot
     *
     * @param snapshotId uint256 - Snapshot ID / block timestamp to look for
     * @param currentValue uint256 - Current value used as fallback
     *
     * @return snapshotId_ uint256 - Best matching snapshot ID
     * @return snapshotValue uint256 - Value at the snapshot or fallback value, if no snapshot was found
     */
    function _lastRewardTimestampAt(
        uint256 snapshotId,
        uint256 currentValue
    ) internal view returns (uint256 snapshotId_, uint256 snapshotValue) {
        (bool snapshotted, uint256 id, uint256 value) = _valueAt(
            snapshotId,
            _lastRewardTimestampSnapshots
        );

        return (id, snapshotted ? value : currentValue);
    }

    /**
     * Triggers a snapshot for current snapshot ID
     */
    function _snapshot() internal returns (uint256) {
        _currentSnapshotId.increment();

        uint256 currentId = _getCurrentSnapshotId();
        return currentId;
    }

    /**
     * Updates the current "in-work" snapshot
     *
     * @param snapshots Snapshots - Snapshots struct / object to update
     * @param currentValue uint256 - New value
     */
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

    /**
     * Current snapshot ID
     */
    function _getCurrentSnapshotId() private view returns (uint256) {
        return block.timestamp;
    }

    /**
     * Last snapshot ID for given array
     *
     * @param ids uint256[] - List of snapshot IDs
     */
    function _lastSnapshotId(
        uint256[] storage ids
    ) private view returns (uint256) {
        if (ids.length == 0) {
            return 0;
        } else {
            return ids[ids.length - 1];
        }
    }

    /**
     * Returns the value at best matching snapshot
     *
     * @param snapshotId uint256 - Snapshot ID / block timestamp to look for
     * @param snapshots Snapshots - Snapshots struct / object
     *
     * @return snapshotFound bool - Indicator, if snapshot was available for the given ID
     * @return snapshotId_ uint256 - Best matching snapshot ID
     * @return snapshotValue uint256 - Value at the snapshot or fallback value, if no snapshot was found
     */
    function _valueAt(
        uint256 snapshotId,
        Snapshots storage snapshots
    )
        private
        view
        returns (bool snapshotFound, uint256 snapshotId_, uint256 snapshotValue)
    {
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
