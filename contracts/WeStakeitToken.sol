// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./interfaces/IWeStakeitToken.sol";

/**
 * @title WeSendit Staking Token
 */
contract WeStakeitToken is
    IWeStakeitToken,
    ERC721,
    ERC721URIStorage,
    ERC721Enumerable,
    Ownable
{
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    constructor() ERC721("WeStakeit", "sWSI") {}

    function mint(
        address receiver
    ) external onlyOwner returns (uint256 tokenId) {
        tokenId = _tokenIds.current();

        _mint(receiver, tokenId);
        _setTokenURI(tokenId, "");

        _tokenIds.increment();
        return tokenId;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function _burn(
        uint256 tokenId
    ) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(IERC165, ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
